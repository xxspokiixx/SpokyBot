// POST and DELETE /api/bots/:id/setup-request: the Set me up press and the chip's x.
import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import type { RequestAuth } from "../request-auth.ts";
import { requiredScope } from "../request-auth.ts";
import { Store } from "../store.ts";
import { createSetupRequestRoutes } from "./setup-request.ts";
import { PASS } from "./table.ts";

const person: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };

function setup(refusal: string | null = null) {
  const store = new Store(() => ({ instanceId: "claude", model: "claude-sonnet-5" }), undefined, undefined, "en");
  const bot = store.createBot({ name: "Ava" });
  const route = createSetupRequestRoutes({ store, language: () => "es", sendRefusal: () => refusal });
  const call = async (method: string, body: unknown, botId = bot.id, path = `/api/bots/${botId}/setup-request`) => {
    let answer: { status: number; body: any } | undefined;
    const handled = await route({ req: {} as never, res: {} as never, url: new URL(`http://x${path}`), path, method, auth: person,
      json: (_res: unknown, status: number, value: unknown) => { answer = { status, body: value }; }, readBody: async () => body } as never);
    return handled === PASS ? "pass" : answer!;
  };
  return { store, bot, call, waiting: () => store.taskByThread(bot.id, bot.threadId)?.setupRequest };
}

beforeEach(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe("the Set me up route", () => {
  it("answers the press with the bot's line in the app's language and marks the conversation; a second press is a no-op", async () => {
    const s = setup();
    const pressed = await s.call("POST", { threadId: s.bot.threadId });
    expect(pressed).toMatchObject({ status: 200, body: { ok: true, message: { role: "bot", kind: "text", text: expect.stringMatching(/^Genial\./) } } });
    expect(s.waiting()).toBeDefined();
    expect(await s.call("POST", { threadId: s.bot.threadId })).toEqual({ status: 200, body: { ok: true, already: true } });
    expect(s.store.messagesFor(s.bot.threadId)).toHaveLength(2);
  });

  it("clears the mark on DELETE", async () => {
    const s = setup();
    await s.call("POST", { threadId: s.bot.threadId });
    expect(await s.call("DELETE", { threadId: s.bot.threadId })).toEqual({ status: 200, body: { ok: true } });
    expect(s.waiting()).toBeUndefined();
  });

  it("refuses a bad body, an unknown bot or conversation, a set-up bot, and a caller who may not write there", async () => {
    const s = setup();
    expect(await s.call("POST", {})).toMatchObject({ status: 400 });
    expect(await s.call("POST", { threadId: "../x" })).toMatchObject({ status: 400 });
    expect(await s.call("POST", { threadId: s.bot.threadId }, "no-such-bot")).toMatchObject({ status: 404 });
    expect(await s.call("POST", { threadId: "other-thread" })).toMatchObject({ status: 404 });
    expect(await s.call("DELETE", { threadId: "other-thread" })).toMatchObject({ status: 404 });
    s.store.patchBot(s.bot.id, { soul: "Only water the garden." });
    expect(await s.call("POST", { threadId: s.bot.threadId })).toMatchObject({ status: 409 });
    const guest = setup("On this Cloud you can only write in conversations you started.");
    expect(await guest.call("POST", { threadId: guest.bot.threadId })).toMatchObject({ status: 403 });
    expect(await guest.call("DELETE", { threadId: guest.bot.threadId })).toMatchObject({ status: 403 });
    expect(guest.store.messagesFor(guest.bot.threadId)).toHaveLength(1);
  });

  it("leaves other paths alone", async () => {
    const s = setup();
    expect(await s.call("GET", undefined)).toBe("pass");
    expect(await s.call("POST", {}, s.bot.id, `/api/bots/${s.bot.id}/messages`)).toBe("pass");
  });

  it("is open to anyone who may write to the bot, like sending a message", () => {
    for (const method of ["POST", "DELETE"]) expect(requiredScope(method, "/api/bots/x/setup-request")).toBe("client");
    expect(requiredScope("PUT", "/api/bots/x/setup-request")).toBe("admin");
  });
});
