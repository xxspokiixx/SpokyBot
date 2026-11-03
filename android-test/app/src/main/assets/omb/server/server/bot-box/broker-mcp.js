// A URL MCP server's secret headers stay with the broker: the turn's server list points the engine at
// `http://127.0.0.1:<broker>/b/<token>/mcp-<name>` with no headers, and the broker adds them for the server's real
// address. The token is bound to the conversation and reused for its later turns while the servers are the same, so a
// long-lived engine process keeps its MCP sessions (the driver's launch key stays the same); it slides with each turn
// and ends at its TTL, or when the servers change.
import { createHash } from "node:crypto";
import { botBox } from "./box.js";
import { brokerUrl } from "./broker.js";
const NAME = /^[a-z0-9][a-z0-9_-]{0,47}$/i;
const MAX_REMEMBERED = 10_000;
/** The live token per conversation and the servers it was minted for. */
const remembered = new Map();
/** The grant name for a server: one URL server per name per conversation. */
export function mcpGrantName(name) {
    return `mcp-${name.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 48)}`;
}
/** Test seam: forget every remembered token. */
export function forgetBrokeredMcp() { remembered.clear(); }
/** The turn's custom servers with every URL server's headers moved to the broker; unchanged when the broker is off. */
export function brokerRemoteMcp(custom, turn, broker = botBox.broker()) {
    if (!broker)
        return custom;
    // A turn starting on this conversation keeps its earlier grants alive (a long-lived engine process reuses them).
    broker.touchThread(turn.threadId);
    const out = {};
    const grants = {};
    const brokered = [];
    for (const [name, server] of Object.entries(custom)) {
        if (!("url" in server) || typeof server.url !== "string" || !NAME.test(name)) {
            out[name] = server;
            continue;
        }
        grants[mcpGrantName(name)] = { upstream: server.url, headers: { ...server.headers } };
        brokered.push(name);
    }
    if (!brokered.length)
        return custom;
    const key = `${turn.botId}\u0000${turn.threadId}`;
    const fingerprint = createHash("sha256").update(JSON.stringify(Object.entries(grants).sort(([a], [b]) => (a < b ? -1 : 1)))).digest("hex");
    const known = remembered.get(key);
    let token = known && known.fingerprint === fingerprint && broker.lookup(known.token, known.grant).ok ? known.token : null;
    if (!token) {
        token = broker.mintForThread({ botId: turn.botId, threadId: turn.threadId, grants }).token;
        remembered.delete(key);
        remembered.set(key, { token, fingerprint, grant: mcpGrantName(brokered[0]) });
        if (remembered.size > MAX_REMEMBERED)
            remembered.delete(remembered.keys().next().value);
    }
    for (const name of brokered) {
        const server = custom[name];
        out[name] = { ...server, url: brokerUrl(broker.port, token, mcpGrantName(name)), headers: {} };
    }
    return out;
}
