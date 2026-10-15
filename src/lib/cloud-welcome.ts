import { useSyncExternalStore } from "react";
import type { CloudMoveOverview } from "../../electron/cloud-move.mjs";
import type { CloudPlanSnapshot } from "../../electron/cloud-account.mjs";
import type { OnboardingStatus } from "@/lib/onboarding";

export type BringChoice = "copy" | "fresh";

interface Snapshot {
  /** The person picked a bot or room: the welcome waits behind the setup card for this session. */
  aside: boolean;
  /** Done or skipped here, before the Cloud's record says so. */
  ended: boolean;
  /** Hints written here and not yet in the Cloud's record. */
  early: readonly string[];
  /** Where Continue setup asked the welcome to open. */
  requested: string | null;
  /** Shown in this session: it stays while the Cloud restarts under it (a copy ends with one). */
  seen: boolean;
}

const INITIAL: Snapshot = { aside: false, ended: false, early: [], requested: null, seen: false };
let snapshot: Snapshot = INITIAL;
const listeners = new Set<() => void>();

function update(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}

export function useCloudWelcome(): Snapshot {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => snapshot,
    () => snapshot,
  );
}

export function stepAsideWelcome(): void { update({ aside: true }); }
export function returnToWelcome(step?: string): void { update({ aside: false, requested: step ?? null }); }
export function takeWelcomeRequest(): string | null {
  const requested = snapshot.requested;
  if (requested) snapshot = { ...snapshot, requested: null };
  return requested;
}
export function endWelcomeHere(): void { update({ ended: true }); }
export function markWelcomeSeen(): void { if (!snapshot.seen) update({ seen: true }); }
export function noteWelcomeHints(ids: readonly string[]): void {
  update({ early: [...new Set([...snapshot.early, ...ids])] });
}
/** Only for tests: the store is module state. */
export function resetCloudWelcome(): void { update(INITIAL); }

export function withEarlyHints(record: OnboardingStatus | undefined, early: readonly string[]): OnboardingStatus | undefined {
  if (!record || early.every((id) => record.hintsSeen.includes(id))) return record;
  return { ...record, hintsSeen: [...new Set([...record.hintsSeen, ...early])] };
}

export function cloudWelcomeShown(stage: string, welcome: Pick<Snapshot, "aside" | "ended" | "seen">): boolean {
  return (stage === "pending" || (stage === "waiting" && welcome.seen)) && !welcome.aside && !welcome.ended;
}

/** What a Cloud's main pane opens on first: the welcome before anything that can start a chat (the first-job question, a job waiting for the sign-in). */
export function cloudFirstRun(shown: { welcome: boolean; intent: boolean; signIn: boolean }): "welcome" | "intent" | "sign-in" | null {
  if (shown.welcome) return "welcome";
  if (shown.intent) return "intent";
  return shown.signIn ? "sign-in" : null;
}

/** Work worth bringing, as main counts it: more than the starter bot, a room or a chat. */
export function hasWork(local: CloudMoveOverview["local"] | null | undefined): boolean {
  return Boolean(local && (local.bots > 1 || local.rooms > 0 || local.chats > 0));
}

/** A copy from the Cloud's own page goes only into an empty Cloud (main checks again), so the welcome offers it before any chat exists. */
export function copyPossible(overview: CloudMoveOverview | null): boolean {
  return Boolean(overview?.destination && overview.cloud?.empty !== false && !overview.blocked && overview.fit?.fit !== "never");
}

export function suggestedChoice(desktop: boolean, overview: CloudMoveOverview | null): BringChoice {
  if (!desktop) return "fresh";
  if (!overview) return "copy";
  return hasWork(overview.local) && copyPossible(overview) ? "copy" : "fresh";
}

export type WelcomeCredit = { state: "active"; left: number | null } | { state: "used_up" | "ended" };

/** The trial's Claude credit as the Cloud's engines report it; the amount only where the desktop app's plan says it. */
export function welcomeCredit(
  instances: ReadonlyArray<{ trialCredit?: "active" | "used_up" | "ended" }>,
  plan: CloudPlanSnapshot | null,
): WelcomeCredit | null {
  const reported = instances.find((instance) => instance.trialCredit)?.trialCredit;
  const credit = plan?.credit;
  if (reported === "active" || (!reported && credit?.state === "active")) {
    return { state: "active", left: credit?.state === "active" ? credit.remainingUsd : null };
  }
  if (reported) return { state: reported };
  return credit?.state === "used_up" ? { state: "used_up" } : null;
}

export const ABOUT_ME_LIMIT = 24_000;

export function withMemory(aboutMe: string | undefined, memory: string): string {
  const before = (aboutMe ?? "").trimEnd(), added = memory.trim();
  if (!added) return before;
  return before ? `${before}\n\n${added}` : added;
}

export function memoryKept(aboutMe: string | undefined, memory: string): boolean {
  return (aboutMe ?? "").includes(memory.trim());
}

const PENDING_MEMORY = "omb.cloudWelcome.memory";

/** A copy replaces About me with this computer's: what was pasted is added again once it lands. */
export function rememberPendingMemory(memory: string | null): void {
  try {
    if (memory?.trim()) globalThis.localStorage?.setItem(PENDING_MEMORY, memory.trim());
    else globalThis.localStorage?.removeItem(PENDING_MEMORY);
  } catch {}
}

export function pendingMemory(): string | null {
  try { return globalThis.localStorage?.getItem(PENDING_MEMORY) || null; } catch { return null; }
}
