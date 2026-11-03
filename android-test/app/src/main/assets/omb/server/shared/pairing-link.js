// The one `openmausbot://pair` link builder, read by the Android and iOS
// scanners (`PairingInvite.parse`). Every value is written with
// encodeURIComponent, so a space is `%20`.
/** How many fallback routes a link will carry. The list is tiny in practice;
 * the cap only keeps a pathological interface table from bloating the QR. */
export const MAX_PAIRING_HOSTS = 8;
const ENDPOINT_KINDS = new Set(["hosted", "tailnet", "lan", "bonjour"]);
/** Strict even for our own sidecar's input: a public URL with credentials or a
 * path is not a companion base URL. Sorted by priority, deduplicated by origin,
 * capped. */
export function qrEndpoints(endpoints) {
    const seen = new Set();
    const valid = [];
    for (const endpoint of endpoints ?? []) {
        if (!endpoint ||
            !ENDPOINT_KINDS.has(endpoint.kind) ||
            !Number.isInteger(endpoint.priority) ||
            endpoint.priority < 0 ||
            endpoint.priority > 1_000_000) {
            continue;
        }
        try {
            const parsed = new URL(endpoint.url);
            const expectedProtocol = endpoint.kind === "hosted" ? "https:" : "http:";
            const explicitPort = parsed.port ? Number(parsed.port) : null;
            const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
            if (parsed.protocol !== expectedProtocol ||
                // No empty DNS label (".ts.net", "mac..local"): the phones refuse
                // one, and one endpoint they refuse makes them refuse the whole QR.
                hostname.split(".").includes("") ||
                (endpoint.kind === "tailnet" && !hostname.endsWith(".ts.net")) ||
                (explicitPort !== null && (!Number.isInteger(explicitPort) || explicitPort < 1 || explicitPort > 65_535)) ||
                parsed.username ||
                parsed.password ||
                parsed.pathname !== "/" ||
                parsed.search ||
                parsed.hash ||
                seen.has(parsed.origin)) {
                continue;
            }
            seen.add(parsed.origin);
            valid.push({ url: parsed.origin, kind: endpoint.kind, priority: endpoint.priority });
        }
        catch {
        }
    }
    return valid.sort((left, right) => left.priority - right.priority).slice(0, MAX_PAIRING_HOSTS);
}
/** URL-safe, unpadded base64 keeps the structured JSON smaller than query
 * escaping every quote and slash while remaining straightforward to decode
 * with Foundation on iOS. */
function encodeEndpoints(endpoints) {
    const bytes = new TextEncoder().encode(JSON.stringify(endpoints));
    let binary = "";
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function validSecretPublicKey(value) {
    if (!value || !/^[A-Za-z0-9_-]{87}$/.test(value))
        return null;
    try {
        const base64 = value.replaceAll("-", "+").replaceAll("_", "/") + "=";
        const decoded = atob(base64);
        if (decoded.length !== 65 || decoded.charCodeAt(0) !== 4)
            return null;
        let binary = "";
        for (let index = 0; index < decoded.length; index += 1)
            binary += decoded[index];
        return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") === value
            ? value
            : null;
    }
    catch {
        return null;
    }
}
/** The `address` value: `host:port` (IPv6 bracketed) or a bare http(s)
 * origin, or null when it is neither. Both phones refuse an address with
 * credentials, a path, a query or a fragment, as `qrEndpoints` does. */
function linkAddress(address, port) {
    const value = address.trim();
    if (!value)
        return null;
    if (/^https?:\/\//i.test(value)) {
        try {
            const parsed = new URL(value);
            if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash)
                return null;
            return parsed.origin;
        }
        catch {
            return null;
        }
    }
    if (port === undefined || !Number.isInteger(port) || port < 1 || port > 65_535)
        return null;
    const authority = value.includes(":") && !value.startsWith("[") ? `[${value}]` : value;
    return `${authority}:${port}`;
}
/**
 * A short-lived handoff from a trusted pairing screen to the mobile app. The
 * credential still has to be redeemed; putting it in the link does not
 * create or expose the long-lived device token. Null when any required part
 * is malformed, so a caller never prints a link a phone would refuse.
 */
export function phonePairingLink({ address, port, token, code, name, hosts, endpoints, secretPublicKey, }) {
    const dial = linkAddress(address, port);
    if (!dial || !/^omb_pair_[A-Za-z0-9_-]{43}$/.test(token))
        return null;
    if (code !== undefined && !/^\d{6}$/.test(code))
        return null;
    const fields = [["address", dial], ["token", token]];
    if (code !== undefined)
        fields.push(["code", code]);
    if (name?.trim())
        fields.push(["name", name.trim()]);
    // Comma-joined, which no hostname or IP literal can contain. A bad candidate
    // is filtered, not fatal: it costs the phone one failed dial.
    const candidates = (hosts ?? [])
        .map((candidate) => candidate.trim())
        .filter((candidate) => candidate && !/[\s/?#,[\]]/.test(candidate))
        .slice(0, MAX_PAIRING_HOSTS);
    if (candidates.length)
        fields.push(["hosts", candidates.join(",")]);
    const routes = qrEndpoints(endpoints);
    if (routes.length)
        fields.push(["endpoints", encodeEndpoints(routes)]);
    const secretKey = validSecretPublicKey(secretPublicKey);
    if (secretKey)
        fields.push(["secretKey", secretKey]);
    return `openmausbot://pair?${fields.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")}`;
}
