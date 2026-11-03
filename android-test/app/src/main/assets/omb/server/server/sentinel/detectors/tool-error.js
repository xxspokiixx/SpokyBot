import { isHeldMemberLine } from "../../room-holds.js";
import { failureKey, HARNESS_NOTICE, signatureOf, toolOrigin } from "../normalize.js";
import { TURN_TIMEOUT_NOTICE } from "./turn-stop.js";
export const SEVERITY_BY_ORIGIN = { harness: "high", external: "medium", shell: "low" };
export const toolError = {
    name: "tool_error",
    detect(records) {
        const observations = [];
        for (const record of records) {
            if (record.type !== "tool" || record.ok)
                continue;
            // a stopped room turn is turn_timeout's, not a tool's
            if (record.tool === HARNESS_NOTICE && TURN_TIMEOUT_NOTICE.test(record.text))
                continue;
            // a member the person held on purpose is not a failure
            if (isHeldMemberLine(record.tool))
                continue;
            const origin = toolOrigin(record.tool);
            const { key, title } = failureKey(record.tool, record.text);
            observations.push({
                kind: "tool_error",
                signature: signatureOf("tool_error", record.tool, key),
                title,
                origin,
                severity: SEVERITY_BY_ORIGIN[origin],
                tool: record.tool,
                threadId: record.threadId,
                at: record.at,
                occurrence: `tool:${record.id}`,
                evidence: { source: "messages", id: record.id },
                ...(record.botId ? { botId: record.botId } : {}),
                ...(record.turnId ? { turnId: record.turnId } : {}),
            });
        }
        return observations;
    },
};
