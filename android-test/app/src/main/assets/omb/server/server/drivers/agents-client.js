// The agents tools' only way to the harness: loopback /api/internal/* with this turn's capability token;
// the harness authenticates and scopes every call.
export function createHarnessClient(baseUrl, token) {
    async function api(path, init) {
        const { ok, status, body } = await apiResponse(path, init);
        if (!ok)
            throw new Error(String(body.error ?? `HTTP ${status}`));
        return body;
    }
    async function apiResponse(path, init) {
        const res = await fetch(baseUrl + path, {
            ...init,
            headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...init?.headers },
        });
        const body = (await res.json().catch(() => ({})));
        return { ok: res.ok, status: res.status, body };
    }
    return { api, apiResponse };
}
/** The client a spawned proxy was given:
 *   OMB_HARNESS_URL  base URL of the harness (http://127.0.0.1:8799)
 *   OMB_COMMS_TOKEN  the capability token for the internal endpoints */
export function harnessClientFromEnv(env) {
    return createHarnessClient(env.OMB_HARNESS_URL ?? "http://127.0.0.1:8799", env.OMB_COMMS_TOKEN ?? "");
}
