// On a team's Cloud a bot's main chat is the team's; a conversation a person opens with the bot is theirs (T2: private to
// them and the team's admins, `private: true` on the wire). Clicking a team bot in the sidebar opens that conversation,
// and makes it the first time through the server's own new-conversation route (POST /api/bots/<id>/tasks), which records
// the person who opened it. Group chats and every other place open as before.
//
// The server tells no one which private chat is theirs: a Member only ever sees their own, but an Admin sees every
// member's too. So an Admin's is the one this device opened (kept per team in this page's storage), never one merely
// marked private; on another device an Admin gets a new conversation rather than someone else's.
import { useEffect } from "react";
import { api } from "./api";
import type { Action, Bot } from "./store";
import { readSessionState } from "@/lib/session";

/** The team on screen and whether this person is a Member (no admin scope): null anywhere but a team's Cloud. */
export type TeamChats = { teamId: string; member: boolean };

type TaskLike = { threadId: string; createdAt?: number; updatedAt?: number; private?: unknown; routineRunId?: unknown; openedBy?: unknown; archivedAt?: unknown; closedBy?: unknown };
type BotLike = { id: string; tasks?: TaskLike[] };

let current: TeamChats | null = null;
export function setTeamChats(next: TeamChats | null) {
  current = next;
}
export function teamChats(): TeamChats | null {
  return current;
}

const KEY = (teamId: string) => `omb.team-own-chats.${teamId}`;
function storage(): Pick<Storage, "getItem" | "setItem"> | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
function kept(teamId: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(storage()?.getItem(KEY(teamId)) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, string> : {};
  } catch { return {}; }
}
export function rememberOwnChat(teamId: string, botId: string, threadId: string) {
  try { storage()?.setItem(KEY(teamId), JSON.stringify({ ...kept(teamId), [botId]: threadId })); } catch {}
}

/** A person's own conversation: private, open, and opened by a person (not a routine's report or a bot's thread). */
const ownKind = (task: TaskLike) => task.private === true && !task.routineRunId && !task.openedBy && !task.archivedAt && !task.closedBy;

/** The conversation clicking this team bot opens: the one this device opened for this person while it is still theirs,
 * else, for a Member, their newest; null when there is none yet (one is made). Never the main chat, and for an Admin
 * never a chat only marked private. */
export function ownChatOf(bot: BotLike, team: TeamChats): string | null {
  const own = (bot.tasks ?? []).filter(ownKind);
  const mine = kept(team.teamId)[bot.id];
  if (mine && own.some((task) => task.threadId === mine)) return mine;
  if (!team.member) return null;
  const newest = [...own].sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))[0];
  return newest?.threadId ?? null;
}

const making = new Set<string>();
/** On a team: opens the person's own conversation with `bot` through `open`, or makes it and opens it. False anywhere
 * else, so the caller opens the bot as it always has. */
export function openOwnTeamChat(dispatch: (action: Action) => void, bot: BotLike, open: (threadId: string) => void): boolean {
  const team = current;
  if (!team) return false;
  const own = ownChatOf(bot, team);
  if (own) { open(own); return true; }
  if (making.has(bot.id)) return true;
  making.add(bot.id);
  void api<{ bot?: Bot; task?: { threadId?: string } }>(`/api/bots/${bot.id}/tasks`, { method: "POST", body: "{}" })
    .then((response) => {
      if (typeof response?.task?.threadId === "string") rememberOwnChat(team.teamId, bot.id, response.task.threadId);
      if (!response?.bot) return;
      dispatch({ type: "taskSwitched", bot: response.bot });
      dispatch({ type: "select", id: bot.id });
    })
    .catch((error: unknown) => dispatch({ type: "error", message: error instanceof Error ? error.message : String(error) }))
    .finally(() => making.delete(bot.id));
  return true;
}

/** The team this page's server is the home of (its config's `team`), else null. */
export function teamOfConfig(config: unknown): { id: string } | null {
  const team = (config as { team?: { id?: unknown } } | null | undefined)?.team;
  return typeof team?.id === "string" && team.id ? { id: team.id } : null;
}

/** Keeps the sidebar's rule in step with the page's server: on a team, the person's own conversations; a Member until
 * the session says otherwise is never assumed (an Admin's rule is the safe one). */
export function useTeamChats(config: unknown) {
  const teamId = teamOfConfig(config)?.id ?? null;
  useEffect(() => {
    if (!teamId) { setTeamChats(null); return; }
    setTeamChats({ teamId, member: false });
    let alive = true;
    void readSessionState().then((session) => {
      if (alive && session.kind === "session") setTeamChats({ teamId, member: !session.scopes.includes("admin") });
    }).catch(() => {});
    return () => { alive = false; };
  }, [teamId]);
}
