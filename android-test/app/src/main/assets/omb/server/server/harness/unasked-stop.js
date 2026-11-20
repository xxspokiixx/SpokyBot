// Engines and gateways may end a turn by saying only that its request was cancelled or aborted (Claude Code's
// "Request was aborted.", a gateway's "context canceled"). After a Stop that sentence is the stop. When nothing asked
// this engine to stop, it is a failure, and the person must read that in words, not see "Stopped" as if they had.
import { clientCancellation } from "../../shared/client-cancel.js";
const SAID_CHARS = 120;
export function unaskedStopMessage(said) {
    const quoted = said.replace(/\s+/g, " ").trim().slice(0, SAID_CHARS).replaceAll('"', "'");
    return `The AI's request was cut off before it finished, and nobody stopped it (it said only "${quoted}"). Send the message again to try once more.`;
}
export function withUnaskedStops(instance) {
    const adapter = instance.adapter;
    const running = new Set();
    const asked = new Set();
    const shown = (item) => {
        if (item.type === "turn.started")
            running.add(item.threadId);
        if (item.type === "turn.completed") {
            running.delete(item.threadId);
            asked.delete(item.threadId);
        }
        if (item.type !== "runtime.error" || asked.has(item.threadId))
            return item;
        const said = clientCancellation(item.message);
        return said === null ? item : { ...item, message: unaskedStopMessage(said) };
    };
    instance.adapter = {
        ...adapter,
        onEvent: (listener) => adapter.onEvent((item) => listener(shown(item))),
        interruptTurn: (threadId, turnId) => {
            asked.add(threadId);
            return adapter.interruptTurn(threadId, turnId);
        },
        stopAll: () => {
            for (const threadId of running)
                asked.add(threadId);
            return adapter.stopAll();
        },
    };
    return instance;
}
