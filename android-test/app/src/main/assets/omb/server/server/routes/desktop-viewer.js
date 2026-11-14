// Only the RFB WebSocket crosses the container boundary: container-controlled JavaScript on the app's origin would reach the person's workspace.
import { createHash } from "node:crypto";
import { request } from "node:http";
import { createConnection } from "node:net";
import { isSameOrigin } from "../request-auth.js";
import { PASS } from "./table.js";
import { createUpgrades } from "./upgrades.js";
const ROUTE = /^\/api\/desktop-viewer\/(local\/(?:shared|bot-[a-f0-9]{64}|pool-\d+)|vps\/[\w-]+)(\/websockify)?$/;
const HANDSHAKE_MS = 10_000;
const RECHECK_MS = 5_000;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const BOT_ID = /^[\w-]+$/;
const CONTROL_LEASE = /^[A-Za-z0-9_-]{16,120}$/;
export function desktopViewerUrl(target, threadId) {
    const params = new URLSearchParams({ target, ...(threadId ? { threadId } : {}) });
    return `/desktop-viewer#${params}`;
}
/** WebSocket framing in one place: client frames are masked and answered, server frames are not.
 * Opcode 2 is binary, which is the only RFB needs: the RFB protocol messages ride inside them. */
function speakWebSocket(client, rfb) {
    let pending = Buffer.alloc(0);
    let fragment = null;
    const toRfb = (chunk) => { rfb.write(chunk); };
    const answer = (payload, opcode = 0x82) => {
        const head = payload.length < 126
            ? Buffer.from([opcode, payload.length])
            : payload.length < 65536
                ? (() => { const b = Buffer.alloc(4); b[0] = opcode; b[1] = 126; b.writeUInt16BE(payload.length, 2); return b; })()
                : (() => { const b = Buffer.alloc(10); b[0] = opcode; b[1] = 127; b.writeBigUInt64BE(BigInt(payload.length), 2); return b; })();
        client.write(Buffer.concat([head, payload]));
    };
    const onClientData = (data) => {
        pending = Buffer.concat([pending, data]);
        while (true) {
            if (pending.length < 2)
                return;
            const first = pending[0];
            const second = pending[1];
            const fin = (first & 0x80) !== 0;
            const opcode = first & 0x0f;
            const masked = (second & 0x80) !== 0;
            let length = second & 0x7f;
            let offset = 2;
            if (length === 126) {
                if (pending.length < 4)
                    return;
                length = pending.readUInt16BE(2);
                offset = 4;
            }
            else if (length === 127) {
                if (pending.length < 10)
                    return;
                length = Number(pending.readBigUInt64BE(2));
                offset = 10;
            }
            const maskOffset = offset;
            if (masked && pending.length < offset + 4)
                return;
            offset += masked ? 4 : 0;
            if (pending.length < offset + length)
                return;
            const mask = masked ? pending.subarray(maskOffset, maskOffset + 4) : null;
            let payload = pending.subarray(offset, offset + length);
            if (mask) {
                const out = Buffer.alloc(length);
                for (let i = 0; i < length; i++)
                    out[i] = payload[i] ^ mask[i % 4];
                payload = out;
            }
            pending = pending.subarray(offset + length);
            const body = fragment === null ? payload : Buffer.concat([fragment, payload]);
            if (opcode === 0x00 || opcode === 0x02) {
                if (fin) {
                    toRfb(body);
                    fragment = null;
                }
                else
                    fragment = body;
            }
            else if (opcode === 0x01) { /* text: the desktop protocol is binary only */ }
            else if (opcode === 0x08) {
                rfb.destroy();
                return;
            }
            else if (opcode === 0x09)
                answer(payload, 0x8a);
        }
    };
    // Every read from the desktop is one frame: RFB messages are small and the framing is cheap,
    // and a large framebuffer update splits across reads into several frames the client joins.
    const onRfbData = (data) => { answer(data); };
    const onClose = () => { try {
        client.destroy();
        rfb.destroy();
    }
    catch { /* already gone */ } };
    client.on("data", onClientData);
    rfb.on("data", onRfbData);
    client.once("close", onClose);
    rfb.once("close", onClose);
    rfb.once("error", onClose);
    return () => {
        client.off("data", onClientData);
        rfb.off("data", onRfbData);
    };
}
export function createDesktopViewer(deps) {
    const upgrades = deps.upgrades ?? createUpgrades();
    const ownGate = deps.upgrades === undefined;
    upgrades.route((path) => Boolean(ROUTE.exec(path)?.[2]));
    const viewers = new Map();
    let stopped = false;
    const route = async ({ req, res, url, path, method, auth, json }) => {
        const match = ROUTE.exec(path);
        if (!match)
            return PASS;
        res.setHeader("cache-control", "private, no-store");
        if (method !== "GET")
            return json(res, 405, { error: "method not allowed" });
        // Also enforced at this boundary: admin and same-origin only.
        if (!auth.scopes.includes("admin") || !isSameOrigin(req))
            return json(res, 403, { error: "forbidden" });
        // A lease-bound viewer: both names or neither, holding before anything is inspected, rechecked on every liveness pass.
        const botId = url.searchParams.get("botId");
        const controlLeaseId = url.searchParams.get("controlLeaseId");
        const threadId = url.searchParams.get("threadId") ?? undefined;
        if ((botId === null) !== (controlLeaseId === null)) {
            return json(res, 400, { error: "botId and controlLeaseId go together" });
        }
        if (botId !== null && (!BOT_ID.test(botId) || !CONTROL_LEASE.test(controlLeaseId) || !deps.lease
            || (threadId !== undefined && !BOT_ID.test(threadId)))) {
            return json(res, 400, { error: "botId, threadId or controlLeaseId is not valid" });
        }
        if (botId === null && threadId !== undefined)
            return json(res, 400, { error: "threadId needs botId and controlLeaseId" });
        // A saved or constructed socket URL must not bypass the join refusal: a bot's lease does not exclude other users of a shared desktop.
        if (botId !== null && (match[1] === "local/shared" || match[1].startsWith("local/pool-"))) {
            return json(res, 409, { error: "Phone control requires a per-bot Local VM. Select per-bot mode in Settings → Computers." });
        }
        const bound = botId === null ? undefined : deps.lease(match[1], botId, controlLeaseId, threadId);
        if (botId !== null && !bound)
            return json(res, 409, { error: "Take control of this computer first" });
        const holds = () => bound?.() ?? true;
        const target = deps.target(match[1]);
        if (!target)
            return json(res, 404, { error: "Desktop not found" });
        const pending = upgrades.pending(req);
        if (pending && stopped) {
            pending.socket.destroy();
            return;
        }
        let upgrade;
        if (pending) {
            const viewer = { socket: pending.socket, close: () => pending.socket.destroy() };
            if (auth.kind === "session")
                viewer.owner = auth.session.id;
            if (botId !== null)
                viewer.botId = botId;
            viewers.set(req, viewer);
            pending.socket.once("close", () => viewers.delete(req));
            upgrade = viewer;
        }
        let connection;
        try {
            connection = await target.resolve();
        }
        catch (error) {
            const status = error && typeof error === "object" && "status" in error ? error.status : 502;
            return json(res, typeof status === "number" && status >= 400 && status < 600 ? status : 502, { error: "The desktop is not available. Open it again from OpenMausBot." });
        }
        // Inspection may outlive a closed tab or the handshake deadline.
        if (res.destroyed || upgrade?.socket.destroyed)
            return;
        const live = () => deps.live(auth) && deps.target(match[1])?.key === target.key && (connection.live?.() ?? true);
        if (!live())
            return json(res, 401, { error: "Viewer access expired" });
        if (!holds())
            return json(res, 409, { error: "Take control of this computer first" });
        if (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535) {
            return json(res, 409, { error: "The desktop viewer is not available." });
        }
        if (!match[2])
            return json(res, 200, { password: connection.password });
        if (!upgrade || !pending)
            return json(res, 426, { error: "WebSocket upgrade required" });
        const key = req.headers["sec-websocket-key"];
        if (req.headers.upgrade?.toLowerCase() !== "websocket" || req.headers["sec-websocket-version"] !== "13"
            || typeof key !== "string" || !/^[A-Za-z0-9+/]{22}==$/.test(key)) {
            return json(res, 400, { error: "Invalid WebSocket handshake" });
        }
        const { socket } = upgrade;
        let peer;
        let recheck;
        const release = connection.retain?.();
        let closed = false;
        const close = () => {
            if (closed)
                return;
            closed = true;
            release?.();
            clearTimeout(timeout);
            clearInterval(recheck);
            peer?.destroy();
            socket.destroy();
        };
        upgrade.close = close;
        const fail = () => {
            if (closed)
                return;
            if (peer || socket.destroyed) {
                close();
                return;
            }
            if (!res.headersSent && !socket.destroyed)
                json(res, 502, { error: "Could not connect to the desktop viewer" });
            socket.destroy();
        };
        socket.once("close", close);
        // The RFB port, when there is one: the bridge is this server's own, so a dropped framebuffer
        // update is not a python bridge's buffering under proot. The protocol is RFB end to end:
        // WebSocket frames carry RFB messages, and the RFB bytes go straight to the desktop.
        if (typeof connection.rfbPort === "number" && connection.rfbPort >= 1) {
            const timeout = setTimeout(fail, HANDSHAKE_MS);
            timeout.unref();
            const rfb = createConnection({ host: "127.0.0.1", port: connection.rfbPort });
            peer = rfb;
            rfb.once("error", fail);
            rfb.once("connect", () => {
                if (closed || socket.destroyed) {
                    rfb.destroy();
                    return;
                }
                if (!live() || !holds()) {
                    fail();
                    return;
                }
                clearTimeout(timeout);
                pending.release();
                res.detachSocket(socket);
                socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${createHash("sha1").update(key + WS_GUID).digest("base64")}\r\n\r\n`);
                speakWebSocket(socket, rfb);
                connection.touch?.();
                recheck = setInterval(() => {
                    if (!live() || !holds())
                        close();
                    else
                        connection.touch?.();
                }, RECHECK_MS);
                recheck.unref();
            });
            return;
        }
        // Fixed host and path, port from an inspected managed container. Never forward cookies, bearer tokens, query parameters or forwarded headers.
        const upstream = request({
            hostname: "127.0.0.1", port: connection.port, path: "/websockify",
            headers: { Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Key": key, "Sec-WebSocket-Version": "13" },
        });
        const timeout = setTimeout(() => fail(), HANDSHAKE_MS);
        timeout.unref();
        upstream.once("error", fail);
        upstream.once("response", (answer) => { answer.resume(); fail(); });
        upstream.once("upgrade", (answer, remote, remoteHead) => {
            const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
            if (!live() || !holds() || socket.destroyed || answer.headers["sec-websocket-accept"] !== accept
                || answer.headers.upgrade?.toLowerCase() !== "websocket") {
                remote.destroy();
                fail();
                return;
            }
            clearTimeout(timeout);
            peer = remote;
            remote.once("error", close);
            remote.once("close", close);
            pending.release();
            res.detachSocket(socket);
            socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
            if (remoteHead.length)
                socket.write(remoteHead);
            if (pending.head.length)
                remote.write(pending.head);
            pending.head = Buffer.alloc(0);
            socket.pipe(remote).pipe(socket);
            connection.touch?.();
            recheck = setInterval(() => {
                if (!live() || !holds())
                    close();
                else
                    connection.touch?.();
            }, RECHECK_MS);
            recheck.unref();
        });
        upstream.end();
    };
    return {
        route,
        attach: upgrades.attach,
        closeForOwner: (owner, botId) => {
            let closed = 0;
            for (const viewer of viewers.values()) {
                if (viewer.owner !== owner || (botId !== undefined && viewer.botId !== botId))
                    continue;
                // A closed viewer stays listed until its socket's close event, which arrives later on Windows.
                if (viewer.socket.destroyed)
                    continue;
                viewer.close();
                closed++;
            }
            return closed;
        },
        closeAll: () => {
            stopped = true;
            if (ownGate)
                upgrades.close();
            for (const viewer of viewers.values())
                viewer.close();
        },
    };
}
