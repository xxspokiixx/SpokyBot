import { isStopCommand } from "../room-holds.js";
export function createPersonStop(deps) {
    const { store } = deps;
    async function stopThreadForPerson(botId, threadId) {
        const routines = deps.routines();
        const routine = routines?.activeBotRunForBot(botId);
        if (routine?.threadId === threadId) {
            await routines.cancelRun(routine.id);
            return;
        }
        deps.handoffs().stoppedByPerson(threadId);
        deps.markStopped(threadId);
        deps.stopGoal(threadId);
        await deps.interruptDirectThread(botId, threadId);
    }
    /** Only a message made of stop words, from a person, acts as Stop: it is recorded, and never reaches the turn it ends. */
    async function stopOnTypedCommand(input) {
        const { botId, threadId, text, trigger } = input;
        if (input.fromApp || (trigger.kind !== "user" && trigger.kind !== "owner") || !isStopCommand(text))
            return null;
        if (input.personPresent)
            deps.clearUnattended(threadId);
        const message = store.appendMessage(threadId, { role: "user", kind: "text", text, ...input.row });
        await stopThreadForPerson(botId, threadId);
        return { ok: true, threadId, message };
    }
    /** "Restart turn": the message already waits in the queue, ahead of all but the person's own earlier messages, and the
     * queue survives Stop, so stopping the running turn starts it over with that message. Like a typed stop, only a
     * person's own send may end the turn. */
    async function restartForPerson(botId, threadId, trigger) {
        if (trigger.kind !== "user" && trigger.kind !== "owner")
            return;
        await stopThreadForPerson(botId, threadId);
    }
    /** Stop left teammates mid-turn: one pill each links to the conversation where Stop reaches that turn. */
    function noteTeammatesLeftRunning(threadId, running) {
        if (!store.botByThread(threadId) && !store.groupByThread(threadId))
            return;
        for (const node of running) {
            const name = store.bot(node.botId)?.name ?? "A teammate";
            const task = store.taskByThread(node.botId, node.threadId);
            store.appendMessage(threadId, {
                role: "bot",
                kind: "activity",
                tool: { name: `Stopped here — ${name} is still working; open to stop it too`, ok: true },
                ...(task ? { threadRef: { botId: node.botId, threadId: node.threadId, title: task.title } } : {}),
            });
        }
    }
    return { stopThreadForPerson, stopOnTypedCommand, restartForPerson, noteTeammatesLeftRunning };
}
