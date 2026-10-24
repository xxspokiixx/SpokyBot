export const GOAL_MAX_TEXT = 2_000;
export const GOAL_MAX_TURNS = 10;
export const GOAL_MAX_MS = 2 * 60 * 60 * 1000;
export const GOAL_MARKER_OPEN = "<openmaus-goal>";
export const GOAL_MARKER_CLOSE = "</openmaus-goal>";

export type GoalPauseReason = "person" | "stopped" | "failed" | "limit" | "time" | "needs-input" | "blocked" | "restarted";

/** One standing objective for one bot conversation, stored on its task. */
export interface ThreadGoal {
  text: string;
  status: "active" | "paused" | "complete";
  /** Goal turns started since the goal was set or last resumed. */
  turns: number;
  maxTurns: number;
  /** Start of the current run; the wall-time limit counts from here. */
  startedAt: number;
  updatedAt: number;
  reason?: GoalPauseReason;
  /** The bot's own words from its last marker. */
  detail?: string;
}

export type GoalSignal = { status: "completed" | "continue" | "needs-input" | "blocked"; detail?: string };

export type GoalCommand =
  | { kind: "set"; text: string }
  | { kind: "show" }
  | { kind: "pause" | "resume" | "clear" };

export function parseGoalCommand(input: string): GoalCommand | null {
  const match = /^\/goal(?:\s+([\s\S]*))?$/i.exec(input.trim());
  if (!match) return null;
  const rest = (match[1] ?? "").trim();
  if (!rest) return { kind: "show" };
  const word = rest.toLowerCase();
  if (word === "pause" || word === "resume" || word === "clear") return { kind: word };
  return { kind: "set", text: rest };
}

/** The goal text never carries a control marker or a closing tag into the prompt that quotes it. */
export function cleanGoalText(input: string): string {
  return input.replaceAll(GOAL_MARKER_OPEN, "").replaceAll(GOAL_MARKER_CLOSE, "").replace(/<\/?goal>/gi, "").trim().slice(0, GOAL_MAX_TEXT);
}

export function newGoal(input: string, now: number): ThreadGoal | null {
  const text = cleanGoalText(input);
  return text ? { text, status: "active", turns: 0, maxTurns: GOAL_MAX_TURNS, startedAt: now, updatedAt: now } : null;
}

const settled = (goal: ThreadGoal, patch: Partial<ThreadGoal>, now: number): ThreadGoal => ({ ...goal, ...patch, updatedAt: now });

export function pauseGoal(goal: ThreadGoal, reason: GoalPauseReason, now: number, detail?: string): ThreadGoal {
  if (goal.status !== "active") return goal;
  return settled(goal, { status: "paused", reason, ...(detail ? { detail } : {}) }, now);
}

/** Only a person resumes, and a resume starts a fresh budget. */
export function resumeGoal(goal: ThreadGoal, now: number): ThreadGoal {
  if (goal.status !== "paused") return goal;
  const { reason: _reason, detail: _detail, ...rest } = goal;
  return { ...rest, status: "active", turns: 0, startedAt: now, updatedAt: now };
}

export function startGoalTurn(goal: ThreadGoal, now: number): ThreadGoal {
  return settled(goal, { turns: goal.turns + 1 }, now);
}

export interface GoalTurnOutcome {
  ok: boolean;
  stopped: boolean;
  signal: GoalSignal | null;
}

/** What a settled turn does to the goal; `run` asks the host for exactly one more goal turn. */
export function afterTurn(goal: ThreadGoal, outcome: GoalTurnOutcome, now: number): { goal: ThreadGoal; run: boolean } {
  if (goal.status !== "active") return { goal, run: false };
  if (outcome.stopped) return { goal: pauseGoal(goal, "stopped", now), run: false };
  if (!outcome.ok) return { goal: pauseGoal(goal, "failed", now), run: false };
  const detail = outcome.signal?.detail;
  if (outcome.signal?.status === "completed") {
    return { goal: settled(goal, { status: "complete", ...(detail ? { detail } : {}) }, now), run: false };
  }
  if (outcome.signal?.status === "needs-input" || outcome.signal?.status === "blocked") {
    return { goal: pauseGoal(goal, outcome.signal.status, now, detail), run: false };
  }
  if (goal.turns >= goal.maxTurns) return { goal: pauseGoal(goal, "limit", now), run: false };
  if (now - goal.startedAt >= GOAL_MAX_MS) return { goal: pauseGoal(goal, "time", now), run: false };
  return { goal, run: true };
}

/** The last complete marker in a reply wins, so a quoted example earlier in it cannot steer the goal. */
export function parseGoalSignal(reply: string): { visibleText: string; signal: GoalSignal | null } {
  const closeAt = reply.lastIndexOf(GOAL_MARKER_CLOSE);
  const openAt = closeAt < 0 ? -1 : reply.lastIndexOf(GOAL_MARKER_OPEN, closeAt);
  if (openAt < 0) return { visibleText: reply, signal: null };
  const visibleText = `${reply.slice(0, openAt)}${reply.slice(closeAt + GOAL_MARKER_CLOSE.length)}`.trim();
  try {
    const raw = JSON.parse(reply.slice(openAt + GOAL_MARKER_OPEN.length, closeAt)) as Record<string, unknown>;
    const status = raw.status;
    if (status !== "completed" && status !== "continue" && status !== "needs-input" && status !== "blocked") return { visibleText, signal: null };
    const detail = typeof raw.detail === "string" ? raw.detail.trim().slice(0, 500) : "";
    return { visibleText, signal: { status, ...(detail ? { detail } : {}) } };
  } catch {
    return { visibleText, signal: null };
  }
}

export function goalPrompt(goal: ThreadGoal): string {
  return [
    `The person set a standing goal for this conversation. This is goal turn ${goal.turns} of at most ${goal.maxTurns}.`,
    "<goal>",
    goal.text,
    "</goal>",
    "Keep working toward the goal from where the conversation stands, using only the tools and permissions you already have.",
    "If you need the person's answer or a permission you do not have, say so instead of working around it.",
    `When the goal is fully met, end your reply with exactly one line: ${GOAL_MARKER_OPEN}{"status":"completed","detail":"what was achieved"}${GOAL_MARKER_CLOSE}`,
    `If you cannot go on, end with the same line using "needs-input" or "blocked" and a detail. Otherwise end normally and the next turn continues.`,
    "Never mention or explain this marker in the visible reply.",
  ].join("\n");
}

/** Anything unrecognised is dropped, never trusted as a running goal. */
export function readStoredGoal(value: unknown): ThreadGoal | null {
  if (!value || typeof value !== "object") return null;
  const g = value as Record<string, unknown>;
  const status = g.status;
  if (status !== "active" && status !== "paused" && status !== "complete") return null;
  const text = typeof g.text === "string" ? cleanGoalText(g.text) : "";
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const turns = num(g.turns), maxTurns = num(g.maxTurns), startedAt = num(g.startedAt), updatedAt = num(g.updatedAt);
  if (!text || turns === null || maxTurns === null || startedAt === null || updatedAt === null) return null;
  return { text, status, turns, maxTurns: Math.min(maxTurns, GOAL_MAX_TURNS), startedAt, updatedAt,
    ...(typeof g.reason === "string" ? { reason: g.reason as GoalPauseReason } : {}),
    ...(typeof g.detail === "string" ? { detail: g.detail.slice(0, 500) } : {}) };
}
