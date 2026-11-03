// Each private thread a room answer recalled from is announced once per room thread; in memory, so a restart re-announces (the safe direction).
const announced = new Map();
export function claimRecallCrossings(roomThreadId, sources) {
    const seen = announced.get(roomThreadId) ?? new Set();
    const threadIds = [];
    let count = 0;
    for (const threadId of sources) {
        if (seen.has(threadId))
            continue;
        if (!threadIds.includes(threadId))
            threadIds.push(threadId);
        count += 1;
    }
    if (!threadIds.length)
        return { threadIds: [], count: 0 };
    for (const threadId of threadIds)
        seen.add(threadId);
    announced.set(roomThreadId, seen);
    return { threadIds, count };
}
export function recallCrossingLabel(botName, count) {
    return `${botName} recalled ${count} message${count === 1 ? "" : "s"} from its private chat with you`;
}
export function forgetRecallCrossings(roomThreadId) {
    if (roomThreadId === undefined)
        announced.clear();
    else
        announced.delete(roomThreadId);
}
export function briefCrossingLabel(botName, count) {
    return `${botName}'s recent-work brief covers ${count} private chat${count === 1 ? "" : "s"} with you`;
}
