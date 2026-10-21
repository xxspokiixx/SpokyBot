// GET /api/cloud-send: Send to My Cloud's comparison of this server (server/cloud-send.ts), or of one item with `item`;
// /api/cloud-send/chats/*: its chats, by row (server/cloud-send-chats.ts); GET /api/cloud-send/manifest: all a move
// carries, to check it by (server/cloud-send-manifest.ts); on a Cloud home, POST /api/cloud-send/verify-secrets: the
// credentials' fingerprints (server/cloud-send-verify.ts); a move's own kinds, memory and bot files
// (server/cloud-send-kinds.ts, cloud-send-memory.ts, cloud-send-files.ts), and what My Cloud keeps once a move is done
// (server/cloud-send-arrived.ts). Admin scope (request-auth's default): the owner's app reads them on this computer and
// on their own Cloud.
import { z } from "zod";

import { botAvatarUrlSchema } from "../../shared/bot-avatar.ts";
import { readAttachment } from "../attachments.ts";
import { arrivedRoute } from "../cloud-send-arrived.ts";
import { moveFilesRoute } from "../cloud-send-files.ts";
import { moveBotParts, moveItems, moveKindsRoute, type MoveKindsDeps } from "../cloud-send-kinds.ts";
import { cloudSendManifest } from "../cloud-send-manifest.ts";
import { moveMemoryRoute, type MoveMemoryDeps } from "../cloud-send-memory.ts";
import { cloudSendSummary, partHash, type CloudSendSources } from "../cloud-send.ts";
import { cloudSendChatsRoute, type CloudSendChatsDeps } from "../cloud-send-chats.ts";
import { loginFingerprints, VERIFY_NONCE } from "../cloud-send-verify.ts";
import type { AppConfig } from "../config.ts";
import type { LoginStore } from "../login-store.ts";
import { threadHeads } from "../message-db.ts";
import type { BotRecord } from "../store.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface CloudSendRouteDeps extends Pick<CloudSendSources, "appVersion" | "bots" | "skills"> {
  messagesTail(threadId: string, limit: number): { messages: ReadonlyArray<{ role: string; text?: string }>; hasMore: boolean };
  logins: Pick<LoginStore, "changes" | "get" | "onePasswordConnectedAt" | "onePasswordGrants" | "onePasswordToken">;
  config(): Pick<AppConfig, "profile" | "language">;
  chats?: CloudSendChatsDeps;
  /** This server is the person's own Cloud: it answers what a move asks of the Cloud it moves to. */
  cloudHome?: boolean;
  /** This server's connections (cloud-connections.ts), by id. */
  connections?(): Promise<ReadonlyArray<{ id: string }>>;
  connectionFingerprints?(nonce: string): Record<string, string>;
  /** What only a move carries: automations, skill extras and bot fields, memory, and bot files. */
  move?: MoveKindsDeps & Omit<MoveMemoryDeps, "bot" | "owner">;
}

export function createCloudSendRoutes(deps: CloudSendRouteDeps): RouteHandler {
  const sources: CloudSendSources = {
    appVersion: deps.appVersion,
    bots: deps.bots,
    greetingOnly: (threadId, name) => {
      const tail = deps.messagesTail(threadId, 2);
      return !tail.hasMore && tail.messages.length === 1 && tail.messages[0]!.role === "bot" && Boolean(tail.messages[0]!.text?.includes(name));
    },
    inRoom: (botId) => (deps.chats?.store.groups ?? []).some((group) => !group.dm && group.memberIds.includes(botId)),
    skills: deps.skills,
    picture: (avatarUrl) => botAvatarUrlSchema.safeParse(avatarUrl).success ? readAttachment(avatarUrl.slice("/api/attachments/".length))?.bytes ?? null : null,
    logins: () => deps.logins.changes(),
    onePassword: () => {
      const connectedAt = deps.logins.onePasswordConnectedAt();
      return connectedAt === null ? null : { connectedAt, grants: deps.logins.onePasswordGrants() };
    },
    settings: () => { const { profile, language } = deps.config(); return { profile, language }; },
    ...(deps.move ? { move: { items: (bots: ReadonlySet<string>) => moveItems(deps.move!, bots), botParts: (bot: BotRecord) => moveBotParts(bot, partHash) } } : {}),
  };
  const move = deps.move;
  return async (ctx) => {
    const { req, res, path, method, url, json, readBody } = ctx;
    if (deps.chats && await cloudSendChatsRoute(deps.chats, ctx)) return;
    if (move && await moveKindsRoute(move, ctx)) return;
    if (move && await moveMemoryRoute({ ...move, bot: (id) => move.store.bot(id) ?? undefined }, ctx)) return;
    if (move && await moveFilesRoute({ dataDir: move.dataDir, bots: () => move.store.bots, owner: move.owner }, ctx)) return;
    if (move && deps.cloudHome && await arrivedRoute({ dataDir: move.dataDir, store: move.store, webhooks: move.webhooks, owner: move.owner }, ctx)) return;
    if (path === "/api/cloud-send/manifest") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      if (!deps.chats) return json(res, 404, { error: "not found" });
      res.setHeader("cache-control", "no-store");
      return json(res, 200, await cloudSendManifest({ summary: () => cloudSendSummary(sources, { move: true }), store: deps.chats.store, dataDir: deps.chats.dataDir,
        connections: deps.connections ?? (async () => []), heads: threadHeads, ...(move ? { kinds: move, teamMemory: move.teamMemory } : {}) }));
    }
    if (path === "/api/cloud-send/verify-secrets") {
      if (!deps.cloudHome || !deps.connectionFingerprints) return json(res, 404, { error: "not found" });
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const asked = z.object({ nonce: z.string().regex(VERIFY_NONCE) }).safeParse(await readBody(req, 4096));
      if (!asked.success) return json(res, 400, { error: "send { nonce }: at least 32 random bytes, base64url" });
      res.setHeader("cache-control", "no-store");
      return json(res, 200, { v: 1, secrets: { ...loginFingerprints(asked.data.nonce, deps.logins), ...deps.connectionFingerprints(asked.data.nonce) } });
    }
    if (path !== "/api/cloud-send") return PASS;
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    res.setHeader("cache-control", "no-store");
    const summary = cloudSendSummary(sources, { move: url.searchParams.get("move") === "1" });
    const item = url.searchParams.get("item");
    const items = item === null ? summary.items : summary.items.filter((entry) => entry.key === item || (entry.kind === "skill" && item === `bot:${entry.bot}`));
    // `chats: 1`: this server takes chats by row.
    return json(res, 200, { ...summary, items, ...(deps.chats ? { chats: 1 } : {}) });
  };
}
