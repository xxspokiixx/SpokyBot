/** Where coordinate_bots sends to a teammate outside a room, by its `thread`: "standing" is the sender conversation's one
 * work thread with that teammate (undefined until it is opened), "new" opens one (undefined), and any other value is the id
 * of a thread the sender opened on that teammate earlier, or `answering`: the requester of the sender's running assignment
 * when it asked with reply none. Nothing returns from such work on its own, so it takes a one-way notice (`notice`) there,
 * never new work.
 * Throws when it is neither. `also` narrows which threads count. */
export function workThreadFor(store, input) {
    const { botId, thread, also } = input;
    if (thread === "new")
        return undefined;
    if (thread === "standing")
        return store.workThread(botId, input.fromBotId, input.fromThreadId, false, also);
    const task = store.taskByThread(botId, thread);
    const usable = task !== undefined && task.archivedAt === undefined && also(task);
    if (usable && task.openedBy?.botId === input.fromBotId && !task.openedBy.roomLane)
        return task;
    const handedWork = usable && input.answering?.botId === botId && input.answering.threadId === thread;
    if (handedWork && input.notice)
        return task;
    if (handedWork)
        throw new Error(`"${thread}" handed you work: answer it there with reply "none", a one-way notice; it cannot be given new work`);
    throw new Error(`"${thread}" is not a thread you opened on ${input.botName}: use a threadId one of your coordinate_bots receipts gave, or one list_threads shows on them`);
}
