// What Settings → MausBot Cloud and My Cloud's strip say about Send to My Cloud (electron/cloud-send.mjs), in words.
import { failedSummary, pendingRows } from "../../electron/cloud-send-parts.mjs";
import type { CloudSendCounts, CloudSendFailure, CloudSendNotice, CloudSendOutcome, CloudSendSnapshot } from "../../electron/cloud-send.mjs";
import type { OneHomeCounts, OneHomeView } from "../../electron/one-home.mjs";
import type { LocaleKey } from "@/locales";
import { activeLocale, t } from "@/lib/i18n";

const counted = (count: number, one: LocaleKey, many: LocaleKey) => t(count === 1 ? one : many, { count });

export const listOf = (parts: string[]) => new Intl.ListFormat(activeLocale(), { type: "conjunction" }).format(parts);

/** "Ember", "Ember and Juno", "Ember, Juno and 2 more". */
export function names(labels: string[], shown = 2): string {
  if (labels.length <= shown + 1) return listOf(labels);
  return listOf([...labels.slice(0, shown), t("cloudSend.more", { count: labels.length - shown })]);
}

/** More than three bots are counted, not named. */
const botsNamed = (bots: string[]) => bots.length > 3 ? [t("cloudSend.list.bots", { count: bots.length })] : bots;

/** "Ember, 2 skills, 3 logins, 1Password and 48 chats". */
export function sentList(result: CloudSendOutcome["result"]): string[] {
  const chats = result.chats;
  return [
    ...botsNamed(result.bots),
    ...(result.updatedBots.length ? [t("cloudSend.list.changesTo", { names: names(result.updatedBots) })] : []),
    ...(result.skills ? [counted(result.skills, "cloudSend.list.skillOne", "cloudSend.list.skills")] : []),
    ...(result.logins ? [counted(result.logins, "cloudSend.list.loginOne", "cloudSend.list.logins")] : []),
    ...(result.onePassword ? [t("cloudSend.list.onePassword")] : []),
    ...(result.settings.length ? [t("cloudSend.list.settings")] : []),
    ...(result.connections ? [counted(result.connections, "cloudSend.list.connectionOne", "cloudSend.list.connections")] : []),
    ...(chats?.conversations ? [counted(chats.conversations, "cloudSend.list.chatOne", "cloudSend.list.chats")]
      : chats?.messages ? [counted(chats.messages, "cloudSend.list.messageOne", "cloudSend.list.messages")] : []),
  ];
}

/** The words main threw, without Electron's "Error invoking remote method" wrapper; null when there are none. */
export function ipcErrorText(cause: unknown): string | null {
  return cause instanceof Error && cause.message ? cause.message.replace(/^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/u, "") : null;
}

/** "2 logins couldn't be sent: <why>. 1Password couldn't be sent: <why>.", or why a send stopped; null when nothing failed. */
export function failedLine(failure: CloudSendFailure): string | null {
  const lines = (failure.reasons ?? []).map(({ what, error }) => {
    const list = [
      ...botsNamed(what.bots),
      ...(what.skills ? [counted(what.skills, "cloudSend.list.skillOne", "cloudSend.list.skills")] : []),
      ...(what.logins ? [counted(what.logins, "cloudSend.list.loginOne", "cloudSend.list.logins")] : []),
      ...(what.onePassword ? [t("cloudSend.list.onePassword")] : []),
      ...(what.settings ? [t("cloudSend.list.settings")] : []),
      ...(what.connections ? [counted(what.connections, "cloudSend.list.connectionOne", "cloudSend.list.connections")] : []),
      ...(what.chats ? [t("cloudSend.list.theChats")] : []),
    ];
    const line = t("cloudSend.failedWhat", { list: listOf(list), error });
    return line.charAt(0).toLocaleUpperCase(activeLocale()) + line.slice(1);
  });
  if (failure.error) lines.push(t("cloudSend.failedSend", { error: failure.error }));
  return lines.length ? lines.join(" ") : null;
}

/** One sentence for what a send did, then a line for each thing worth knowing. */
export function resultLines(outcome: CloudSendOutcome): { text: string; failed: boolean; notes: string[] } {
  const { result } = outcome;
  const sent = sentList(result);
  const failure = failedLine(failedSummary(outcome));
  const text = [
    sent.length ? t("cloudSend.result.sent", { list: listOf(sent) }) : failure ? "" : t("cloudSend.result.none"),
    failure ?? "",
  ].filter(Boolean).join(" ");
  const notes = [...new Set(result.notes.map((note) =>
    note.kind === "model" ? t("cloudSend.result.model", { bot: note.bot ?? "" })
      : note.kind === "settings" ? t("cloudSend.result.settings", { bot: note.bot ?? "" })
        : note.kind === "memory" ? t("cloudSend.result.memory", { bot: note.bot ?? "" })
          : note.kind === "held" ? t("cloudSend.result.held", { key: note.connection ?? "" })
            : t("cloudSend.result.narrowed")))];
  return { text, failed: Boolean(failure), notes };
}

/** Every failure in this send is one trying again can't fix (1Password refused the token), so there is no Try again. */
export function finalFailure(outcome: CloudSendOutcome | null): boolean {
  return Boolean(outcome && !outcome.error && outcome.result.failed.length && outcome.result.failed.every((entry) => entry.final === true));
}

/** What of this computer's My Cloud lacks, from the last comparison: "2 bots, 1 login and 12 chats". */
export function waitingList(snapshot: Pick<CloudSendSnapshot, "rows" | "chats">): string[] {
  const rows = pendingRows({ rows: snapshot.rows });
  const count = (kind: string) => rows.filter((row) => row.kind === kind).length;
  return countedList({ bots: rows.filter((row) => row.kind === "bot" && row.state === "only-here").length, updatedBots: rows.filter((row) => row.kind === "bot" && row.state === "to-update").length,
    skills: count("skill"), logins: count("login"), onePassword: count("1password") > 0, settings: count("setting"),
    chats: snapshot.chats?.waiting ? { conversations: snapshot.chats.waiting, messages: 0 } : null });
}

/** Settings' one line on where things stand: sending, what couldn't go, what is not on My Cloud yet, or that all is. */
export function sendStateLine(snapshot: CloudSendSnapshot, last: CloudSendOutcome | null): { kind: "sending" | "failed" | "waiting" | "done"; text: string } {
  const running = snapshot.running;
  if (running) {
    const key = running.phase === "chats" ? "cloudSend.sendingChats" : "cloudSend.sending";
    return { kind: "sending", text: running.progress ? `${t(key)} ${t("cloudSend.progress", running.progress)}` : t(key) };
  }
  const failure = last ? failedLine(failedSummary(last)) : null;
  if (failure) return { kind: "failed", text: failure };
  const waiting = waitingList(snapshot);
  return waiting.length ? { kind: "waiting", text: t("cloudSend.state.waiting", { list: listOf(waiting) }) } : { kind: "done", text: t("cloudSend.state.done") };
}

/** The status line at the top: online and its version, or why it can't compare now. */
export function statusLine(snapshot: CloudSendSnapshot, comparing: boolean): { text: string; tone: "status" | "note" } | null {
  if (snapshot.cloud === "none") return null;
  if (snapshot.cloud === "ready") {
    const older = snapshot.cloudVersion && snapshot.localVersion && olderVersion(snapshot.cloudVersion, snapshot.localVersion);
    return older ? { text: t("cloudSend.status.older", { cloud: snapshot.cloudVersion!, local: snapshot.localVersion! }), tone: "note" }
      : { text: t("cloudSend.status.ready", { version: snapshot.cloudVersion ?? "" }), tone: "status" };
  }
  if (comparing) return { text: t("cloudSend.status.checking"), tone: "status" };
  const key: Record<string, LocaleKey> = {
    asleep: "cloudSend.status.asleep", unreachable: "cloudSend.status.unreachable", outdated: "cloudSend.status.outdated",
    "signed-out": "cloudSend.status.signedOut", "local-unavailable": "cloudSend.status.local",
  };
  return { text: t(key[snapshot.cloud] ?? "cloudSend.status.unreachable"), tone: "note" };
}

function olderVersion(a: string, b: string): boolean {
  const [left, right] = [a, b].map((version) => /^(\d+)\.(\d+)\.(\d+)/.exec(version)?.slice(1).map(Number));
  if (!left || !right) return false;
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! < right[i]!;
  return false;
}

/** "12 bots, 3 skills, 2 logins, 1Password and 48 chats", from counts only. */
export function countedList(sent: CloudSendCounts): string[] {
  const chats = sent.chats;
  return [
    ...(sent.bots ? [counted(sent.bots, "cloudSend.list.botOne", "cloudSend.list.bots")] : []),
    ...(sent.updatedBots ? [counted(sent.updatedBots, "cloudSend.list.changedBotOne", "cloudSend.list.changedBots")] : []),
    ...(sent.skills ? [counted(sent.skills, "cloudSend.list.skillOne", "cloudSend.list.skills")] : []),
    ...(sent.logins ? [counted(sent.logins, "cloudSend.list.loginOne", "cloudSend.list.logins")] : []),
    ...(sent.onePassword ? [t("cloudSend.list.onePassword")] : []),
    ...(sent.settings ? [t("cloudSend.list.settings")] : []),
    ...(chats?.conversations ? [counted(chats.conversations, "cloudSend.list.chatOne", "cloudSend.list.chats")]
      : chats?.messages ? [counted(chats.messages, "cloudSend.list.messageOne", "cloudSend.list.messages")] : []),
  ];
}

/** The move, or an older desktop's first send by itself: the strip shows it arriving and what it brought. */
const ARRIVING = new Set(["move", "first"]);

/** My Cloud's strip, or null when all is well: this computer's things on their way (the move, or Try again), what the
 * move brought, or what couldn't come and why. */
export function stripLine(notice: CloudSendNotice, sending: boolean, unanswered: string | null): { kind: "sending" | "failed" | "done"; text: string } | null {
  if (sending || (notice.running && ARRIVING.has(notice.runningReason ?? ""))) {
    const progress = notice.progress;
    const key = notice.phase === "chats" ? "cloudSend.strip.bringingChats" : "cloudSend.strip.bringing";
    return { kind: "sending", text: progress ? `${t(key)} ${t("cloudSend.progress", progress)}` : t(key) };
  }
  if (unanswered !== null) return { kind: "failed", text: t("cloudSend.failedSend", { error: unanswered }) };
  const last = notice.last;
  if (!last || last.seen) return null;
  const failure = failedLine(last);
  if (failure) return { kind: "failed", text: failure };
  if (!ARRIVING.has(last.reason)) return null;
  const list = countedList(last.sent);
  return { kind: "done", text: list.length ? t("cloudSend.strip.arrived", { list: listOf(list) }) : t("cloudSend.strip.allHere") };
}

/** "4 bots, 2 skills, 2 logins, 1Password, 148 chats and 2 routines": what the move checked on both sides. */
export function arrivedList(counts: OneHomeCounts): string[] {
  return [
    ...(counts.bots ? [counted(counts.bots, "cloudSend.list.botOne", "cloudSend.list.bots")] : []),
    ...(counts.skills ? [counted(counts.skills, "cloudSend.list.skillOne", "cloudSend.list.skills")] : []),
    ...(counts.logins ? [counted(counts.logins, "cloudSend.list.loginOne", "cloudSend.list.logins")] : []),
    ...(counts.onePassword ? [t("cloudSend.list.onePassword")] : []),
    ...(counts.chats ? [counted(counts.chats, "cloudSend.list.chatOne", "cloudSend.list.chats")] : []),
    ...(counts.routines ? [counted(counts.routines, "cloudSend.list.routineOne", "cloudSend.list.routines")] : []),
  ];
}

/** The one-time move's line on either page: on its way (with progress, or who it waits for), almost done, failing for a
 * day (with Try again), what arrived (on My Cloud's page, once), or coming home. `page`: which page shows it. */
export function moveLine(move: OneHomeView, page: "local" | "cloud"): { kind: "sending" | "failed" | "done"; text: string; extra: string[]; phone?: true; retry?: true } | null {
  if (move.phase === "done") {
    if (page !== "cloud") return null;
    const list = move.counts ? arrivedList(move.counts) : [];
    return { kind: "done", text: list.length ? t("cloudSend.move.done", { list: listOf(list) }) : t("cloudSend.move.doneAll"),
      extra: move.held.map((key) => t("cloudSend.result.held", { key })), ...(move.phone ? { phone: true as const } : {}) };
  }
  if (move.phase === "home-again" || move.phase === "back") {
    if (page !== "local") return null;
    return { kind: "done", text: t(move.phase === "home-again" ? "cloudSend.move.homeAgain" : move.lost ? "cloudSend.move.backLost" : "cloudSend.move.back"), extra: [] };
  }
  const failing = "failing" in move ? move.failing : undefined;
  if (failing) return { kind: "failed", text: failing.error ? t("cloudSend.move.failing", { error: failing.error }) : t("cloudSend.move.failingPlain"), extra: [], retry: true };
  if (move.phase === "finishing") return { kind: "sending", text: t("cloudSend.move.finishing"), extra: [] };
  if (move.phase === "wait") {
    return { kind: "sending", text: move.waitingFor ? t("cloudSend.move.waiting", { name: move.waitingFor }) : t("cloudSend.move.waitingAny"), extra: [] };
  }
  const chats = move.phase === "copy" ? move.chats : undefined;
  const key = page === "cloud" ? (chats ? "cloudSend.move.bringingChats" : "cloudSend.move.bringing") : (chats ? "cloudSend.move.copyChats" : "cloudSend.move.copy");
  return { kind: "sending", text: t(key, chats ? { done: chats.done, total: chats.total } : {}), extra: [] };
}
