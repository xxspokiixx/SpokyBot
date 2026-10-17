// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "@/state/store";

const fixture = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  dispatch: vi.fn(),
  api: vi.fn(async (..._args: unknown[]) => ({}) as unknown),
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }),
  api: (...args: unknown[]) => fixture.api(...args),
}));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => false }));

const { ApprovalCard } = await import("./ApprovalCard");

const now = Date.now();
const bot = { id: "bot-1", name: "Scout", hidden: false };
const routine = {
  id: "routine-1", name: "Morning brief", prompt: "Summarize the inbox and post the three priorities.", target: "bot", botId: "bot-1", runOn: "maus",
  enabled: true, schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] }, durationMinutes: 30, nextRunAt: now + 3_600_000,
  createdAt: now, updatedAt: now,
};
const webhook = {
  id: "hook-1", endpointId: "wh_abc", name: "Interested replies", prompt: "Draft a follow-up for the lead.", botId: "bot-1", runOn: "maus",
  enabled: true, createdAt: now, updatedAt: now, deliveryCount: 0,
};
const base = { version: 1 as const, requestId: "request-1", botId: "bot-1", threadId: "thread-1", createdAt: now };
function card(extra: Partial<NonNullable<Message["card"]>>): Message {
  return {
    id: "card-1", role: "bot", kind: "options", at: now,
    card: { title: "Trigger", subtitle: "", options: [], answered: "allow", dismissed: true, autoApplied: true, requestId: "request-1", ...extra },
  };
}
const scheduleCard = card({ tool: "schedule_routine", routineRequest: { ...base, resultId: "routine-1", operation: { action: "create", routine: {
  name: "Morning brief", instructions: routine.prompt, schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] }, runOn: "maus", durationMinutes: 30,
} }, undo: { name: "Morning brief" } } });
const webhookCard = card({ tool: "create_trigger", webhookRequest: { ...base, resultId: "hook-1", operation: { action: "create", webhook: { name: "Interested replies", instructions: webhook.prompt, runOn: "maus" } }, undo: { name: "Interested replies" } } });

const render = (message: Message) => renderToStaticMarkup(createElement(ApprovalCard, { bot: { name: "Scout" }, message, threadId: "thread-1" }));
let root: Root | null = null;
/** Mounts the card for real and clicks the button with this label, so the click runs through React as a person's would. */
function click(message: Message, label: string) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root!.render(createElement(ApprovalCard, { bot: { name: "Scout" }, message, threadId: "thread-1" })));
  const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
  if (!button) throw new Error(`no ${label} button in ${container.innerHTML}`);
  flushSync(() => button.click());
}
afterEach(() => { root?.unmount(); root = null; document.body.innerHTML = ""; });

beforeEach(() => {
  fixture.dispatch.mockReset();
  fixture.api.mockReset();
  fixture.api.mockResolvedValue({});
  fixture.state = { bots: [bot], routines: [routine], webhooks: [webhook], routineRuns: [], routinesLoadState: "ready" };
});

describe("the live trigger card a chat-made trigger leaves", () => {
  it("shows what fires it, who does what, and the next run, with Edit, Pause and Undo — never a confirmation", () => {
    const html = render(scheduleCard);
    expect(html).toContain('data-trigger-card="routine-1"');
    expect(html).toContain("Trigger on");
    expect(html).toContain("Morning brief");
    expect(html).toContain("→ Scout");
    expect(html).toContain("Summarize the inbox");
    expect(html).toContain("Next ");
    for (const label of ["Edit", "Pause", "Undo"]) expect(html).toContain(`${label}</button>`);
    expect(html).not.toMatch(/Confirm|Waiting for your confirmation/);
  });

  it("updates as runs come in: last fired, its result, and how many today", () => {
    fixture.state.routineRuns = [
      { id: "run-2", routineId: "routine-1", botId: "bot-1", status: "completed", scheduledFor: now - 60_000, startedAt: now - 60_000, createdAt: now - 60_000, threadId: "exec-2", output: "Three priorities: invoices, hiring, launch.\nMore detail." },
      { id: "run-1", routineId: "routine-1", botId: "bot-1", status: "failed", scheduledFor: now - 120_000, startedAt: now - 120_000, createdAt: now - 120_000, error: "Gmail token expired" },
    ];
    const html = render(scheduleCard);
    expect(html).toContain("Last fired");
    expect(html).toContain("Completed");
    expect(html).toContain("Three priorities: invoices, hiring, launch.");
    expect(html).not.toContain("More detail.");
    expect(html).toContain("2 today");
    expect(html).toContain("Open</button>");
  });

  it("says when a run needs the person", () => {
    fixture.state.routineRuns = [{ id: "run-3", routineId: "routine-1", botId: "bot-1", status: "waiting", attention: "Approve the reply to Ada?", scheduledFor: now, createdAt: now }];
    expect(render(scheduleCard)).toContain("Needs your input");
  });

  it("pauses through the store, and reads Trigger paused with Resume once paused", () => {
    click(scheduleCard, "Pause");
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "updateRoutine", routineId: "routine-1", patch: { enabled: false } });
    fixture.state.routines = [{ ...routine, enabled: false }];
    const html = render(scheduleCard);
    expect(html).toContain("Trigger paused");
    expect(html).toContain("Resume</button>");
  });

  it("undoes through the conversation's undo route with the card's request id", () => {
    click(scheduleCard, "Undo");
    expect(fixture.api).toHaveBeenCalledWith("/api/threads/thread-1/undo", { method: "POST", body: JSON.stringify({ requestId: "request-1" }) });
  });

  it("opens the trigger's drawer on the Triggers page", () => {
    click(scheduleCard, "Open in Triggers");
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "showRoutines", view: "list", routineId: "routine-1" });
  });

  it("shows a webhook trigger waiting for its first call, with Copy link and no secret on the card", () => {
    const html = render(webhookCard);
    expect(html).toContain('data-trigger-card="hook-1"');
    expect(html).toContain("When its link is called");
    expect(html).toContain("Waiting for the first call");
    expect(html).toContain("Copy link</button>");
    expect(html).not.toMatch(/whsec_|wh_abc/);
  });

  it("pauses a webhook trigger through its own API", async () => {
    fixture.api.mockResolvedValue({ webhook: { ...webhook, enabled: false } });
    click(webhookCard, "Pause");
    await vi.waitFor(() => expect(fixture.dispatch).toHaveBeenCalledWith({ type: "webhookPatched", webhook: { ...webhook, enabled: false } }));
    expect(fixture.api).toHaveBeenCalledWith("/api/webhooks/hook-1", { method: "PATCH", body: JSON.stringify({ enabled: false, verificationPending: false }) });
  });

  it("collapses to one muted line once undone, or when the trigger is gone", () => {
    expect(render({ ...scheduleCard, card: { ...scheduleCard.card!, undone: true } })).toContain("Trigger “Morning brief” removed · undone");
    fixture.state.routines = [];
    const gone = render(scheduleCard);
    expect(gone).toContain("no longer exists");
    expect(gone).not.toContain("Pause</button>");
  });
});
