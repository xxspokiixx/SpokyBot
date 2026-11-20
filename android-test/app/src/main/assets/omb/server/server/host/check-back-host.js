import { serverLine } from "../server-lines.js";
import { wallClockLabel } from "./check-back-time.js";
const WORDS = {
    pending: "server.checkBack.pending",
    started: "server.checkBack.started",
    cancelled: "server.checkBack.cancelled",
    dropped: "server.checkBack.cancelled",
    failed: "server.checkBack.failed",
};
export function checkBackRow(record, line, language) {
    const when = wallClockLabel(line.startedAt ?? record.dueAt, record.zone);
    return {
        role: "bot", kind: "activity",
        tool: { name: serverLine(language, WORDS[line.status], { when }), ok: line.status !== "failed" },
        checkBack: line,
    };
}
/** Writes the line, or rewrites it when it is still there; a line someone deleted is written again at the end. */
export function writeCheckBackLine(store, record, line, messageId, language) {
    const row = checkBackRow(record, line, language);
    if (messageId && store.messagesFor(record.threadId).some((message) => message.id === messageId)) {
        store.patchMessage(record.threadId, messageId, { tool: row.tool, checkBack: line });
        return messageId;
    }
    if (line.status !== "pending")
        return messageId;
    return store.appendMessage(record.threadId, row).id;
}
