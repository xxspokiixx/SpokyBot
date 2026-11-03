// An engine reads a connector's tools/list once, when its session starts: a list that fails then leaves the whole
// session without connected-app tools. So each backend's last good list stands in for a failed or rate-limited one.
export function parseMcpResponse(text, id) {
    const trimmed = text.trim();
    if (!trimmed)
        return null;
    const candidate = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
    if (trimmed.startsWith("{")) {
        const parsed = JSON.parse(trimmed);
        return candidate(parsed) ? parsed : null;
    }
    const frames = trimmed
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter((line) => line && line !== "[DONE]")
        .flatMap((line) => {
        try {
            return [JSON.parse(line)];
        }
        catch {
            return [];
        }
    })
        .filter(candidate);
    return frames.findLast((frame) => frame.id === id) ?? frames.at(-1) ?? null;
}
const lastToolsLists = new Map();
function toolsListId(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
        return null;
    const frame = payload;
    return frame.method === "tools/list" && frame.id !== undefined ? { id: frame.id } : null;
}
function toolsResult(text, id) {
    try {
        const result = parseMcpResponse(text, id)?.result;
        return Array.isArray(result?.tools) ? result : undefined;
    }
    catch {
        return undefined;
    }
}
/** `backend` names the endpoint and credential, so one backend's list is never served for another. */
export async function withToolsListFallback(backend, payload, send) {
    const request = toolsListId(payload);
    if (!request)
        return send();
    const cached = lastToolsLists.get(backend);
    const fallback = () => Response.json({ jsonrpc: "2.0", id: request.id, result: cached });
    let response;
    try {
        response = await send();
    }
    catch (error) {
        if (cached === undefined)
            throw error;
        return fallback();
    }
    if (response.ok) {
        const result = toolsResult(await response.clone().text(), request.id);
        if (result !== undefined)
            lastToolsLists.set(backend, result);
    }
    else if (cached !== undefined && (response.status >= 500 || response.status === 429)) {
        await response.body?.cancel();
        return fallback();
    }
    return response;
}
