// A goal in a one-on-one chat, run as a room of one: the bot leads and does the work itself, one turn at a time.
import { randomUUID } from "node:crypto";
import { failedTurnTool } from "../../shared/failed-turn.js";
import { GROUP_GOAL_WAIT_MAX_MS, runGoalRun } from "../group-goal-run.js";
import { OUTSIDE, workOrigin } from "../peer-provenance.js";
const LOST_RACE_RETRY_MS = 250;
export function createOneOnOneGoals(deps) {
    const { store } = deps;
    const live = new Map();
    function finish(threadId, goal, status, detail) {
        deps.cards.finish(threadId, goal.run, status, detail, () => Boolean(store.taskByThread(goal.botId, threadId)));
    }
    function availability(goal, botId, threadId) {
        if (goal.cancelled)
            return "cancelled";
        if (!store.bot(botId) || !store.taskByThread(botId, threadId))
            return "unavailable";
        return deps.canStart(botId, threadId) ? "ready" : null;
    }
    function waitUntilFree(goal, bot, threadId, remainingMs) {
        const now = availability(goal, bot.id, threadId);
        if (now)
            return Promise.resolve(now);
        if (remainingMs <= 0)
            return Promise.resolve("timed_out");
        deps.cards.progress(threadId, goal.run, `${bot.name} is finishing what it is doing. This goal will continue when it is free.`);
        return new Promise((resolve) => {
            let settled = false;
            const check = () => {
                const next = availability(goal, bot.id, threadId);
                if (next)
                    done(next);
            };
            const poll = setInterval(check, 1_000);
            poll.unref?.();
            const cap = setTimeout(() => done("timed_out"), remainingMs);
            cap.unref?.();
            const unsubscribe = store.onChange((change) => {
                if ((change.type === "bot" || change.type === "bot.deleted") && change.botId === bot.id)
                    check();
            });
            function done(result) {
                if (settled)
                    return;
                settled = true;
                clearInterval(poll);
                clearTimeout(cap);
                unsubscribe();
                goal.wake = undefined;
                resolve(result);
            }
            goal.wake = check;
        });
    }
    async function step(goal, threadId, request, bot, instructions) {
        const { run } = goal;
        const stayedBusy = () => {
            const minutes = Math.max(1, Math.round(GROUP_GOAL_WAIT_MAX_MS / 60_000));
            return { ran: false, replyText: "", outcome: "busy", stopReason: `${bot.name} stayed busy for ${minutes} minute${minutes === 1 ? "" : "s"}` };
        };
        // One wait cap for the whole step: the busy wait and the lost-slot retries share it, so neither restarts the clock.
        const deadline = Date.now() + GROUP_GOAL_WAIT_MAX_MS;
        for (;;) {
            if (goal.cancelled || run.turnCount >= run.maxTurns)
                return { ran: false, replyText: "" };
            const free = await waitUntilFree(goal, bot, threadId, deadline - Date.now());
            if (free === "cancelled")
                return { ran: false, replyText: "", outcome: "cancelled" };
            if (free === "unavailable")
                return { ran: false, replyText: "", outcome: "unavailable", stopReason: `${bot.name} is no longer available` };
            if (free === "timed_out")
                return stayedBusy();
            let settle;
            const settled = new Promise((resolve) => { settle = resolve; });
            const lead = deps.turns.begin(threadId);
            let outcome;
            try {
                try {
                    await deps.startTurn(bot.id, instructions, {
                        threadId,
                        cardContinuation: true,
                        requestMessageId: request.id,
                        origin: request.origin,
                        unattended: deps.isUnattended(bot.id, threadId),
                        onSettled: settle,
                    });
                }
                catch (error) {
                    const code = error?.code;
                    const message = error instanceof Error ? error.message : String(error);
                    if (code === "thread_busy" || code === "thread_limit") {
                        outcome = "busy";
                        // The chat looked free but the turn kept losing its slot; past the wait cap the run ends blocked, as a busy wait does.
                        if (Date.now() + LOST_RACE_RETRY_MS >= deadline)
                            return stayedBusy();
                        await new Promise((resolve) => setTimeout(resolve, LOST_RACE_RETRY_MS));
                        continue;
                    }
                    if (code === "spend_cap") {
                        store.appendMessage(threadId, { role: "bot", kind: "activity", tool: failedTurnTool(message) });
                        outcome = "spend_capped";
                    }
                    else {
                        outcome = "dispatch_failed";
                    }
                    return { ran: false, replyText: "", outcome, stopReason: message };
                }
                run.turnCount += 1;
                deps.cards.progress(threadId, run, `${bot.name} is working on turn ${run.turnCount} of ${run.maxTurns}.`);
                const result = await settled;
                if (goal.cancelled) {
                    outcome = "cancelled";
                    return { ran: false, replyText: "", outcome };
                }
                outcome = result.stalled ? "stalled" : result.ok ? "settled" : "provider_failed";
                return {
                    ran: true,
                    replyText: result.ok ? lead.assistantItems.join("\n") : "",
                    outcome,
                    ...(result.ok ? {} : { stopReason: result.text }),
                };
            }
            finally {
                deps.turns.end(threadId, lead, outcome);
            }
        }
    }
    /** Appends the person's goal line and its run card, then works until the bot reports an outcome or the turns run out. */
    function start(botId, threadId, text, options = {}) {
        const bot = store.bot(botId);
        if (!bot || !store.taskByThread(botId, threadId))
            throw Object.assign(new Error("no such conversation"), { status: 404 });
        if (live.has(threadId)) {
            throw Object.assign(new Error("A goal is already running in this chat. Stop it before starting another."), { status: 409 });
        }
        const message = store.appendMessage(threadId, {
            role: "user",
            kind: "text",
            text,
            channelMode: "goal",
            ...(options.sendId ? { sendId: options.sendId } : {}),
            ...(options.sender ? { sender: options.sender } : {}),
        });
        store.titleTaskFromFirstMessage(botId, text, threadId);
        const goal = {
            run: deps.cards.start(threadId, bot, text, options.runId ?? `goal-${Date.now().toString(36)}-${randomUUID()}`),
            botId,
            cancelled: false,
        };
        live.set(threadId, goal);
        const request = { id: message.id, origin: options.runId ? OUTSIDE : workOrigin(message) };
        void runGoalRun({
            run: goal.run,
            coordinator: bot,
            members: [bot],
            solo: true,
            cancelled: () => goal.cancelled,
            current: (id) => store.bot(id) ?? undefined,
            step: (member, _coordinator, instructions) => step(goal, threadId, request, member, instructions),
            finish: (status, detail) => finish(threadId, goal, status, detail),
            progress: (detail) => deps.cards.progress(threadId, goal.run, detail),
            note: (line) => store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: line, ok: false } }),
        })
            .catch((error) => finish(threadId, goal, "failed", error instanceof Error ? error.message : String(error)))
            .finally(() => {
            finish(threadId, goal, "failed", "The goal run ended before the bot reported an outcome.");
            if (live.get(threadId) === goal)
                live.delete(threadId);
        });
        return message;
    }
    /** Ends the run on its card at once; the turn in flight is the caller's to interrupt. */
    function stop(threadId, outcome = { status: "stopped", detail: "Stopped by you." }) {
        const goal = live.get(threadId);
        if (!goal || goal.cancelled)
            return false;
        goal.cancelled = true;
        live.delete(threadId);
        finish(threadId, goal, outcome.status, outcome.detail);
        goal.wake?.();
        return true;
    }
    return { start, stop };
}
