import { describe, expect, it } from "vitest";

import type { WebhookTrigger } from "../../shared/webhooks.ts";
import { parseRoomPostPayload, postWebhookToRoom, type RoomPostDeps, type RoomPostRoom } from "./webhook-room-post.ts";

const limits = { maxTextChars: 200, maxVoiceChars: 1_000, maxImages: 4, maxImageBytes: 64 };

// threadId deliberately differs from id: a receipt that reports the room id as the thread would pass the wrong way round.
const room: RoomPostRoom = { id: "room-1", threadId: "room-1-thread", dm: false, memberIds: ["maus-1"], name: "Ops" };

const trigger = {
  id: "hook-1",
  endpointId: "wh_test",
  name: "Ops brief",
  prompt: "",
  botId: "maus-1",
  runOn: "maus",
  delivery: "post",
  groupId: "room-1",
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
  deliveryCount: 0,
} as unknown as WebhookTrigger;

type Calls = {
  appended: Array<{ botId: string; roomId: string; content: { text: string; attachments?: Array<{ kind: string; path: string; mime: string }> } }>;
  synthesized: Array<{ botId: string; text: string }>;
  savedAudio: string[];
  savedImages: string[];
};

function deps(overrides: Partial<RoomPostDeps> = {}): { deps: RoomPostDeps; calls: Calls } {
  const calls: Calls = { appended: [], synthesized: [], savedAudio: [], savedImages: [] };
  const base: RoomPostDeps = {
    limits,
    room: (groupId) => (groupId === room.id ? room : undefined),
    checkBotRoom: () => ({ ok: true }),
    voiceAllowed: () => true,
    synthesize: async (botId, text) => {
      calls.synthesized.push({ botId, text });
      return { bytes: Buffer.from("pcm"), mime: "audio/mpeg" };
    },
    saveAudio: (_bytes, mime) => {
      const path = `/audio/${calls.savedAudio.length}.mp3`;
      calls.savedAudio.push(path);
      return { path, mime };
    },
    saveImage: (_bytes, mime) => {
      const path = `/image/${calls.savedImages.length}.png`;
      calls.savedImages.push(path);
      return { path, mime };
    },
    appendRoomPost: (_trigger, botId, target, content) => {
      calls.appended.push({ botId, roomId: target.id, content });
    },
  };
  return { deps: { ...base, ...overrides }, calls };
}

const png = Buffer.from("png-bytes").toString("base64");

function status(run: () => unknown): number | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return (error as { status?: number }).status;
  }
}

describe("parseRoomPostPayload", () => {
  it("rejects a missing or empty text before touching storage", () => {
    expect(() => parseRoomPostPayload({}, limits)).toThrow(/non-empty "text"/);
    expect(() => parseRoomPostPayload({ text: "   " }, limits)).toThrow(/non-empty "text"/);
    expect(() => parseRoomPostPayload({ text: "x".repeat(limits.maxTextChars + 1) }, limits)).toThrow(/at most 200 characters/);
  });

  it("reads a voice note and images, and enforces every ceiling", () => {
    const parsed = parseRoomPostPayload({ text: " brief ", voiceNote: " hello ", images: [{ data: png, mime: "image/png" }] }, limits);
    expect(parsed.text).toBe("brief");
    expect(parsed.voiceNoteText).toBe("hello");
    expect(parsed.imageBytes).toHaveLength(1);
    expect(parsed.imageMimes).toEqual(["image/png"]);

    expect(status(() => parseRoomPostPayload({ text: "x", voiceNote: "y".repeat(limits.maxVoiceChars + 1) }, limits))).toBe(413);
    expect(() => parseRoomPostPayload({ text: "x", voiceNote: "" }, limits)).toThrow(/non-empty string/);
    expect(() => parseRoomPostPayload({ text: "x", images: Array.from({ length: 5 }, () => ({ data: png, mime: "image/png" })) }, limits))
      .toThrow(/at most 4 images/);
    expect(status(() => parseRoomPostPayload({ text: "x", images: [{ data: Buffer.alloc(limits.maxImageBytes + 1).toString("base64"), mime: "image/png" }] }, limits))).toBe(413);
    expect(() => parseRoomPostPayload({ text: "x", images: [{ data: png, mime: "application/pdf" }] }, limits)).toThrow(/supported "mime"/);
  });
});

describe("postWebhookToRoom", () => {
  it("appends exactly one bot-authored message to the room thread", async () => {
    const h = deps();
    const result = await postWebhookToRoom(h.deps, trigger, { text: "Pipeline is green" });

    expect(result).toEqual({ posted: true, attachments: 0, threadId: "room-1-thread" });
    expect(h.calls.appended).toHaveLength(1);
    expect(h.calls.appended[0]).toEqual({
      botId: "maus-1",
      roomId: "room-1",
      content: { text: "Pipeline is green" },
    });
    expect(h.calls.appended[0]!.content).not.toHaveProperty("attachments");
  });

  it("attaches one audio note synthesized in the bot's voice, first among attachments", async () => {
    const h = deps();
    const result = await postWebhookToRoom(h.deps, trigger, { text: "Listen up", voiceNote: "hello there", images: [{ data: png, mime: "image/png" }] });

    expect(h.calls.synthesized).toEqual([{ botId: "maus-1", text: "hello there" }]);
    expect(result).toEqual({ posted: true, attachments: 2, threadId: "room-1-thread" });
    expect(h.calls.appended[0]!.content.attachments).toEqual([
      { kind: "audio", path: "/audio/0.mp3", mime: "audio/mpeg" },
      { kind: "image", path: "/image/0.png", mime: "image/png" },
    ]);
  });

  it("stores nothing and appends nothing when synthesis fails, and never touches images first", async () => {
    const h = deps({ synthesize: async () => { throw Object.assign(new Error("the voice engine is asleep"), { status: 503 }); } });
    await expect(postWebhookToRoom(h.deps, trigger, { text: " hi ", voiceNote: "hi", images: [{ data: png, mime: "image/png" }] }))
      .rejects.toThrow("the voice engine is asleep");
    expect(h.calls.savedImages).toEqual([]);
    expect(h.calls.savedAudio).toEqual([]);
    expect(h.calls.appended).toEqual([]);
  });

  it("refuses a voice note for a bot with voice notes off and stores no images either", async () => {
    const h = deps({ voiceAllowed: () => false });
    await expect(postWebhookToRoom(h.deps, trigger, { text: "hi", voiceNote: "hi", images: [{ data: png, mime: "image/png" }] }))
      .rejects.toThrow(/voice notes are turned off/);
    expect(h.calls.synthesized).toEqual([]);
    expect(h.calls.savedImages).toEqual([]);
    expect(h.calls.appended).toEqual([]);
  });

  it("attaches every accepted image", async () => {
    const h = deps();
    const result = await postWebhookToRoom(h.deps, trigger, {
      text: "chart",
      images: Array.from({ length: 4 }, () => ({ data: png, mime: "image/png" })),
    });
    expect(result).toEqual({ posted: true, attachments: 4, threadId: "room-1-thread" });
    expect(h.calls.savedImages).toHaveLength(4);
    expect(h.calls.appended[0]!.content.attachments?.map((attachment) => attachment.kind)).toEqual(["image", "image", "image", "image"]);
  });

  it("reports the room's thread, never the room id, for a plain post", async () => {
    const h = deps();
    const result = await postWebhookToRoom(h.deps, trigger, { text: "hi" });
    expect(result).toEqual({ posted: true, attachments: 0, threadId: "room-1-thread" });
    expect(result.threadId).not.toBe(room.id);
  });

  it("rejects a non-member before staging anything", async () => {
    const h = deps({ checkBotRoom: () => ({ ok: false as const, status: 403, error: "that bot is not a member of that room" }) });
    await expect(postWebhookToRoom(h.deps, trigger, { text: "hi", voiceNote: "hi", images: [{ data: png, mime: "image/png" }] }))
      .rejects.toThrow("not a member");
    expect(h.calls.savedAudio).toEqual([]);
    expect(h.calls.savedImages).toEqual([]);
    expect(h.calls.appended).toEqual([]);
  });

  it("rejects a payload with no text and a webhook with no room", async () => {
    const h = deps();
    await expect(postWebhookToRoom(h.deps, trigger, { voiceNote: "hi" })).rejects.toThrow(/non-empty "text"/);
    expect(h.calls.appended).toEqual([]);

    const homeless = deps({ room: () => undefined });
    await expect(postWebhookToRoom(homeless.deps, trigger, { text: "hi" })).rejects.toThrow(/room no longer exists/);
    const noGroup = deps();
    await expect(postWebhookToRoom(noGroup.deps, { ...trigger, groupId: undefined } as WebhookTrigger, { text: "hi" }))
      .rejects.toThrow(/no room to post to/);
  });
});
