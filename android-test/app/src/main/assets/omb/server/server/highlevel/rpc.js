// The JSON-RPC entry the harness proxy reaches: tools/list (filtered to what this bot may run) and tools/call
// (validate → per-bot verdict → run). The turn's capability must still be live before and after the call.
import { HIGHLEVEL_INSTRUCTIONS } from "./instructions.js";
import { HIGHLEVEL_TOOLS, highlevelErrorResult, highlevelToolCallProblem, isHighLevelToolName, runHighLevelTool } from "./tools.js";
export const HIGHLEVEL_INTERNAL_MCP_PATH = "/api/internal/highlevel/mcp";
export async function highlevelRpc(request, deps) {
    if (request?.method === "tools/list") {
        deps.assertActive();
        return { tools: HIGHLEVEL_TOOLS.filter((tool) => deps.authorize(tool.name).ok), instructions: HIGHLEVEL_INSTRUCTIONS };
    }
    if (request?.method !== "tools/call")
        throw Object.assign(new Error("unsupported highlevel method"), { status: 400 });
    const params = (request.params && typeof request.params === "object" ? request.params : {});
    const args = params.arguments ?? {};
    const problem = highlevelToolCallProblem(params.name, args);
    if (problem || !isHighLevelToolName(params.name))
        return highlevelErrorResult(problem ?? "Unknown HighLevel tool.", { code: "invalid_input" });
    const name = params.name;
    deps.assertActive();
    const verdict = deps.authorize(name);
    if (!verdict.ok)
        return highlevelErrorResult(verdict.text, { code: "refused" });
    const { result, write } = await deps.client.withActiveCall(deps.assertActive, () => runHighLevelTool(deps.client, name, args));
    deps.assertActive();
    if (write && !result.isError)
        deps.onWrite?.(write);
    return result;
}
