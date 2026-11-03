// What server/index.ts needs from the HighLevel integration, in one object so the host file gains only a few lines:
// the per-turn mount, the prompt part, the internal MCP handler (per-bot verdict, decision rows, write activity) and
// the Cloud health merge.
import { HIGHLEVEL_MCP_SERVER } from "../../shared/highlevel.js";
import { appendDecision } from "../decision-log.js";
import { harnessMcpTokenEnv } from "../harness-mcp-token.js";
import { AGENTS_NODE_FLAG, SPAWNED_PROXIES } from "../proxy-paths.js";
import { highlevelAccess, highlevelAllowedFor, highlevelSystemPrompt } from "./access.js";
import { highlevelRpc } from "./rpc.js";
import { HIGHLEVEL_TOOLS } from "./tools.js";
/** "contact abc: email, tags": the record and the field names, never the values. */
export function writeSummary(record) {
    return `${record.kind} ${record.recordId}: ${record.fields.join(", ")}`.slice(0, 240);
}
export function createHighLevelHost(deps) {
    const { service } = deps;
    const mounts = (bot) => service.connected() && highlevelAllowedFor(bot);
    return {
        mounts,
        integration(bot, mint, harnessUrl) {
            if (!mounts(bot))
                return null;
            const token = mint();
            return {
                command: process.execPath, args: [SPAWNED_PROXIES.harnessMcp, HIGHLEVEL_MCP_SERVER],
                env: { ...AGENTS_NODE_FLAG, [harnessMcpTokenEnv("highlevel")]: token, OMB_HARNESS_URL: harnessUrl },
            };
        },
        prompt: (bot) => highlevelSystemPrompt(bot),
        toolListing: () => (service.status().state === "unavailable" ? null : { highlevel: HIGHLEVEL_TOOLS.map(({ name, description }) => ({ name, description })) }),
        async handle(body, capability, assertActive) {
            return highlevelRpc(body, {
                client: service.client,
                assertActive,
                // Re-read the live bot on every call, so a permission change wins over a request authenticated under the old one.
                authorize: (name) => {
                    const bot = deps.bot(capability.botId);
                    if (!bot)
                        return { ok: false, text: "This bot no longer exists." };
                    const verdict = highlevelAccess(bot, name);
                    for (const row of verdict.rows) {
                        appendDecision(deps.dataDir, { threadId: capability.threadId, botId: bot.id, botName: bot.name, tool: row.tool, decision: row.decision, source: "connector-scope", rule: row.rule, ...(row.summary ? { summary: row.summary } : {}) });
                    }
                    return verdict.ok ? { ok: true } : { ok: false, text: verdict.text };
                },
                onWrite: (record) => {
                    const bot = deps.bot(capability.botId);
                    deps.appendMessage(capability.threadId, {
                        role: "bot", kind: "activity",
                        tool: { name: `mcp__${HIGHLEVEL_MCP_SERVER}__${record.tool}`, ok: true, summary: writeSummary(record) },
                        ...(bot && deps.inRoom(capability.threadId) ? { from: { botId: bot.id, name: bot.name, color: bot.color } } : {}),
                    });
                },
            });
        },
        health(base) {
            const connection = service.store.get();
            if (!connection)
                return base;
            const highlevel = { connected: connection.state === "signed-in" };
            return (base ?? Promise.resolve({})).then((connectors) => ({ ...connectors, highlevel }), () => ({ highlevel }));
        },
    };
}
