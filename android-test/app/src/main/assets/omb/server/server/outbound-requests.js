import { randomUUID } from "node:crypto";
import { describeTool } from "./activity.js";
export class OutboundRequestService {
    held = new Map();
    open(input) {
        const requestId = randomUUID();
        let settle;
        const answer = new Promise((resolve) => {
            settle = resolve;
        });
        const timer = setTimeout(() => this.settle(requestId, "timeout"), input.timeoutMs);
        timer.unref?.();
        this.held.set(requestId, { botId: input.botId, threadId: input.threadId, tool: input.tool, settle, timer });
        return { requestId, answer };
    }
    settle(requestId, answer) {
        const entry = this.held.get(requestId);
        if (!entry || entry.answered)
            return;
        entry.answered = answer;
        clearTimeout(entry.timer);
        entry.settle(answer);
    }
    resolve(input) {
        const entry = this.held.get(input.requestId);
        if (!entry || entry.threadId !== input.threadId)
            return { claimed: false };
        if (entry.answered)
            return { claimed: true, state: "already_settled", behavior: entry.answered };
        const answer = input.behavior === "allow" ? "allow" : "deny";
        this.settle(input.requestId, answer);
        return { claimed: true, state: answer === "allow" ? "allowed" : "denied" };
    }
    pending(threadId) {
        return [...this.held.entries()]
            .filter(([, entry]) => entry.threadId === threadId && !entry.answered)
            .map(([requestId]) => requestId);
    }
    forget(requestId) {
        const entry = this.held.get(requestId);
        if (entry)
            clearTimeout(entry.timer);
        this.held.delete(requestId);
    }
}
/** What a "Send on your behalf?" card shows: each app action and its arguments, cut at 400 characters. */
export function outboundCard(outboundCalls) {
    const calls = outboundCalls.map((call) => {
        const { app, label } = describeTool(call.slug);
        return { app, label };
    });
    const summary = outboundCalls.map((call, index) => {
        const described = calls[index];
        const argsText = call.arguments === undefined ? "" : JSON.stringify(call.arguments);
        return `${described.app ? `${described.app} · ` : ""}${described.label}${argsText ? `\n${argsText.slice(0, 400)}${argsText.length > 400 ? "… [arguments truncated]" : ""}` : ""}`;
    }).join("\n\n");
    return { app: calls[0]?.app ?? null, calls, summary };
}
