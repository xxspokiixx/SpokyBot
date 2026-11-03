// The turn's capability must still be live before and after anything touches the database.
import { DATA_INSTRUCTIONS } from "./instructions.js";
import { DATA_TOOLS, dataErrorResult, dataToolCallProblem, runDataTool } from "./tools.js";
export const DATA_INTERNAL_MCP_PATH = "/api/internal/data/mcp";
export async function dataRpc(request, deps) {
    if (request?.method === "tools/list") {
        deps.assertActive();
        return { tools: DATA_TOOLS, instructions: DATA_INSTRUCTIONS };
    }
    if (request?.method !== "tools/call")
        throw Object.assign(new Error("unsupported data method"), { status: 400 });
    const params = (request.params && typeof request.params === "object" ? request.params : {});
    const args = params.arguments ?? {};
    const problem = dataToolCallProblem(params.name, args);
    if (problem)
        return dataErrorResult({ code: "invalid_input", message: problem });
    deps.assertActive();
    const { assertActive, ...context } = deps;
    let shown;
    const result = await runDataTool({ ...context, connection: "bot", by: "bot" }, params.name, args, (card) => { shown = card; });
    assertActive();
    if (!result.isError && shown) {
        const current = deps.sheet.card(shown.id);
        // Cleanup may yield while another edit replaces this result: never receipt that edit as ours.
        if (current?.status === "ready" && current.result === shown.result)
            deps.onShow?.(shown);
    }
    return result;
}
