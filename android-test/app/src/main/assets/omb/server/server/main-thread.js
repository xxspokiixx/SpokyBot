export function oldestThread(tasks) {
    const visible = tasks.filter((task) => !task.routineRunId);
    const open = visible.filter((task) => task.archivedAt === undefined);
    return (open.length ? open : visible).reduce((oldest, task) => (!oldest || task.createdAt < oldest.createdAt ? task : oldest), undefined)?.threadId;
}
export function wasOldestThread(tasks, threadId) {
    const saved = tasks.find((task) => task.threadId === threadId && !task.routineRunId);
    return saved !== undefined && !tasks.some((task) => !task.routineRunId && task.archivedAt === undefined && task.createdAt < saved.createdAt);
}
export function mainThread(tasks, selectedId) {
    const open = tasks.filter((task) => !task.routineRunId && task.archivedAt === undefined);
    const asked = open.reduce((latest, task) => ((task.askedAt ?? -1) > (latest?.askedAt ?? -1) ? task : latest), undefined);
    return asked?.threadId ?? open.find((task) => task.threadId === selectedId)?.threadId ?? oldestThread(tasks);
}
