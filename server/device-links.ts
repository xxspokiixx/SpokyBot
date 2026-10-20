// My Cloud's end of each lent computer's device link: while that computer is online and lends its internet
// connection, the bots' browsers here reach the web through it, so sites see the person's own connection.
import { isIP, type Socket } from "node:net";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

import { createLinkMux, LINK_ASLEEP, LINK_ENDED, MAX_CHUNK, type LinkMux, type LinkOpened } from "../electron/device-link-protocol.mjs";

const PING_MS = 10_000;

/** A lent computer's internet connection, as one connection's way out. */
export interface DeviceRoute { open(target: { host: string; port: number }): Promise<LinkOpened> }

export interface LinkedComputer {
  /** The lending registration's own key: its session and computer id. */
  key: string;
  person: string;
  internet: boolean;
  /** The address My Cloud sees the computer connect from: its home's public address, which it never connects to. */
  seenAs: string | null;
}

interface Link { ws: WebSocket; mux: LinkMux; computer: LinkedComputer; since: number; heard: boolean; ping: NodeJS.Timeout }

export class DeviceLinks {
  readonly #server = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: MAX_CHUNK + 4 });
  readonly #links = new Map<string, Link>();
  readonly #pingMs: number;
  #closed = false;

  constructor(options: { pingMs?: number } = {}) {
    this.#pingMs = options.pingMs ?? PING_MS;
  }

  /** Answers the handshake for a computer the route has authorized. A Cloud going to sleep closes it as asleep, so the
   * computer waits for it to wake instead of dialling it; a newer link for the same computer replaces this one. */
  accept(upgrade: { req: IncomingMessage; socket: Socket; head: Buffer }, computer: LinkedComputer, power?: { sleeping(): boolean; sleepSignal(): AbortSignal } | null): void {
    this.#server.handleUpgrade(upgrade.req, upgrade.socket, upgrade.head, (ws) => {
      if (this.#closed) { ws.close(1001, "restarting"); return; }
      if (power?.sleeping()) { ws.close(LINK_ASLEEP, "asleep"); return; }
      this.drop(computer.key, 1000);
      const mux = createLinkMux({ send: (frame) => { if (ws.readyState === ws.OPEN) ws.send(frame); } });
      const link: Link = { ws, mux, computer: { ...computer, seenAs: computer.seenAs && isIP(computer.seenAs) ? computer.seenAs : null }, since: Date.now(), heard: true, ping: setInterval(() => {
        if (!link.heard) { ws.terminate(); return; }
        link.heard = false;
        try { ws.ping(); } catch {}
      }, this.#pingMs) };
      link.ping.unref();
      this.#links.set(computer.key, link);
      ws.send(JSON.stringify({ t: "hello", ...(link.computer.seenAs ? { seenAs: link.computer.seenAs } : {}) }));
      ws.on("pong", () => { link.heard = true; });
      ws.on("message", (data, binary) => {
        link.heard = true;
        const frame = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
        if (binary) return mux.receive(frame);
        const text = frame.toString("utf8");
        if (text === JSON.stringify({ t: "ping" })) { ws.send(JSON.stringify({ t: "pong" })); return; }
        mux.receive(text);
      });
      ws.on("error", () => ws.terminate());
      ws.once("close", () => {
        clearInterval(link.ping);
        mux.close();
        if (this.#links.get(computer.key) === link) this.#links.delete(computer.key);
      });
      const sleep = power?.sleepSignal();
      sleep?.addEventListener("abort", () => ws.close(LINK_ASLEEP, "asleep"), { once: true });
    });
  }

  /** The newest open link of `person`'s computers that lends its internet connection, or null. */
  route(person: string): DeviceRoute | null {
    let newest: Link | null = null;
    for (const link of this.#links.values()) {
      if (link.computer.person !== person || !link.computer.internet || link.ws.readyState !== link.ws.OPEN) continue;
      if (!newest || link.since > newest.since) newest = link;
    }
    const chosen = newest;
    return chosen ? { open: (target) => chosen.mux.open(target) } : null;
  }

  /** Lending from that computer ended or changed: its link ends with it. */
  drop(key: string, code = LINK_ENDED): void {
    const link = this.#links.get(key);
    if (!link) return;
    this.#links.delete(key);
    link.ws.close(code, code === LINK_ENDED ? "lending ended" : "replaced");
  }

  close(): void {
    this.#closed = true;
    for (const link of this.#links.values()) link.ws.close(1001, "restarting");
    this.#links.clear();
  }
}
