import { rmSync } from "node:fs";

import { IMAGE_MAX_BYTES, saveAudio, saveImage } from "../attachments.ts";
import type { BotRecord, GroupRecord, Store } from "../store.ts";
import type { AppConfig } from "../config.ts";
import * as tts from "../tts/index.ts";
import type { WebhookManagerOptions } from "../webhooks.ts";
import type { RoomTalksVerdict } from "./room-access.ts";
import { postWebhookToRoom, type RoomPostRoom } from "./webhook-room-post.ts";

export interface WebhookRoomDeps {
  store: Store;
  cfg: AppConfig;
  /** The same membership and section verdict a bot's own post_to_room call gets. */
  roomTalks(bot: BotRecord, group: GroupRecord): RoomTalksVerdict;
  broadcast(message: Record<string, unknown>): void;
}

/** A webhook's owner configures it from the dashboard, so refusals name the webhook's bot rather than speaking as it. */
function roomPostProblem(bot: BotRecord, verdict: Exclude<RoomTalksVerdict, { ok: true }>): string {
  if (verdict.problem === "dm") return `@${bot.name} reaches that bot in a one-to-one channel; a webhook room post needs a room`;
  if (verdict.problem === "not-member") return `@${bot.name} is not a member of that room`;
  if (verdict.problem === "outsider") return `that room includes @${verdict.name}, who is outside @${bot.name}'s section`;
  return "that room is still being set up — it cannot receive messages yet";
}

/** The room half of webhook delivery: membership gates at create/patch, and a one-message, bot-authored post per delivery. */
export function createWebhookRoomPost(deps: WebhookRoomDeps): Pick<WebhookManagerOptions, "roomMember" | "roomPost"> {
  const { store, cfg } = deps;
  const botRoom = (botId: string): BotRecord | undefined => {
    const bot = store.bot(botId);
    return bot && !bot.hidden ? bot : undefined;
  };
  const verdict = (botId: string, room: RoomPostRoom): { ok: true } | { ok: false; status: number; error: string } => {
    const bot = botRoom(botId);
    if (!bot) return { ok: false as const, status: 404, error: "The assigned MAUS no longer exists" };
    const group = store.group(room.id);
    if (!group) return { ok: false as const, status: 404, error: "That room no longer exists" };
    const talks = deps.roomTalks(bot, group);
    return talks.ok ? { ok: true as const } : { ok: false as const, status: 403, error: roomPostProblem(bot, talks) };
  };
  return {
    roomMember: (botId, groupId) => {
      const bot = botRoom(botId);
      if (!bot) return { ok: false as const, status: 404, error: "That MAUS no longer exists" };
      const group = store.group(groupId);
      if (!group) return { ok: false as const, status: 404, error: "That room no longer exists" };
      return verdict(botId, { id: group.id, threadId: group.threadId, dm: group.dm === true, memberIds: group.memberIds, name: group.name });
    },
    roomPost: (trigger, payload) => postWebhookToRoom({
      limits: { maxTextChars: 20_000, maxVoiceChars: 1_000, maxImages: 4, maxImageBytes: IMAGE_MAX_BYTES },
      room: (groupId) => {
        const group = store.group(groupId);
        return group ? { id: group.id, threadId: group.threadId, dm: group.dm === true, memberIds: group.memberIds, name: group.name } : undefined;
      },
      checkBotRoom: (botId, room) => verdict(botId, room),
      voiceAllowed: (botId) => store.bot(botId)?.voiceNotes !== false,
      synthesize: async (botId, text) => {
        const audio = await tts.speak(cfg, text, store.bot(botId)?.voice);
        return { bytes: Buffer.from(audio.bytes), mime: audio.mime };
      },
      saveAudio,
      saveImage,
      removeStaged: (path) => rmSync(path, { force: true }),
      appendRoomPost: (_trigger, botId, room, content) => {
        const bot = botRoom(botId);
        const group = store.group(room.id);
        if (!bot || !group) throw Object.assign(new Error("the bot or room disappeared mid-delivery"), { status: 404 });
        const talks = deps.roomTalks(bot, group);
        if (!talks.ok) throw Object.assign(new Error(roomPostProblem(bot, talks)), { status: 403 });
        const appended = store.appendMessage(group.threadId, {
          role: "bot",
          kind: "text",
          text: content.text,
          from: { botId: bot.id, name: bot.name, color: bot.color },
          webhookPost: true,
          ...(content.attachments?.length ? { attachments: content.attachments } : {}),
        } as Parameters<Store["appendMessage"]>[1]);
        store.patchGroup(group.id, { unread: true });
        deps.broadcast({ kind: "message", threadId: group.threadId, message: appended, roomId: group.id });
      },
    }, trigger, payload),
  };
}
