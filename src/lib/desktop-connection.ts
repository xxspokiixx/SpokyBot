import RFB from "@novnc/novnc";
import { DESKTOP_VIEWER_TARGET } from "../../shared/desktop-viewer";

export interface DesktopConnectionEvents {
  connected(): void;
  disconnected(): void;
  clipboard?(text: string): void;
}

/** The connection never came up: the link was wrong, the desktop is gone, or it did not answer in time. */
export class DesktopUnreachable extends Error {
  readonly invalid: boolean;
  constructor(invalid = false) {
    super(invalid ? "invalid desktop link" : "desktop unreachable");
    this.invalid = invalid;
  }
}

/** Security: only desktop pixels and input cross the VM boundary. The app's own noVNC client talks RFB through the
 * desktop proxy; the VM never supplies page code. A VPS opens its tunnel first; a Local VM's viewer runs with it. */
export async function connectDesktop(screen: HTMLElement, target: string, options: {
  threadId?: string | null;
  signal: AbortSignal;
  events: DesktopConnectionEvents;
}): Promise<RFB> {
  if (!DESKTOP_VIEWER_TARGET.test(target)) throw new DesktopUnreachable(true);
  const { signal: cancelled, events } = options;
  const signal = AbortSignal.any([cancelled, AbortSignal.timeout(30_000)]);
  if (target.startsWith("vps/")) {
    const query = options.threadId ? `?${new URLSearchParams({ threadId: options.threadId })}` : "";
    const joined = await fetch(`/api/bots/${target.slice(4)}/computer/join${query}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal,
    });
    if (!joined.ok) throw new DesktopUnreachable();
  }
  const path = `/api/desktop-viewer/${target}`;
  const response = await fetch(path, { signal, credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new DesktopUnreachable();
  const config = await response.json();
  cancelled.throwIfAborted();
  const websocket = new URL(`${path}/websockify`, location.href);
  websocket.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const client = new RFB(screen, websocket.href, {
    credentials: { password: config.password ?? "", username: "", target: "" },
  });
  client.scaleViewport = true;
  client.background = "var(--color-inset)";
  // The phone's own proxy chain (WebView -> server -> websockify -> x11vnc) can take over ten
  // seconds to serve its first handshake, because python and x11vnc run under proot. Fifteen
  // seconds cut that handshake off after the version banner had already arrived.
  let ended = false;
  const deadline = setTimeout(() => { client.disconnect(); end(); }, 25_000);
  function end() {
    clearTimeout(deadline);
    if (ended || cancelled.aborted) return;
    ended = true;
    events.disconnected();
  }
  cancelled.addEventListener("abort", () => clearTimeout(deadline), { once: true });
  client.addEventListener("connect", () => {
    clearTimeout(deadline);
    if (!cancelled.aborted) events.connected();
  });
  client.addEventListener("disconnect", end);
  client.addEventListener("clipboard", (event) => {
    if (!cancelled.aborted) events.clipboard?.(event.detail.text);
  });
  return client;
}

/** Explicit text entry works with phone keyboards without reading the clipboard; non-Latin text uses Unicode keysyms. */
export function typeOnDesktop(client: RFB, text: string): void {
  for (const char of text) {
    const code = char.codePointAt(0)!;
    client.sendKey(code === 10 ? 0xff0d : code === 9 ? 0xff09 : code <= 255 ? code : 0x01000000 | code, null);
  }
}

/** The keys a soft keyboard produces that are not literal characters. A tablet sends these with no
 *  physical key behind them, so they map to X keysyms rather than to `code`. Characters go through
 *  `typeOnDesktop` instead, which is what beforeinput reports. */
const NAMED_KEYSYMS: Record<string, number> = {
  Enter: 0xff0d,
  Backspace: 0xff08,
  Tab: 0xff09,
  Escape: 0xff1b,
  Delete: 0xffff,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  Home: 0xff50,
  End: 0xff57,
  PageUp: 0xff55,
  PageDown: 0xff56,
  Insert: 0xff63,
};

/** Forwards one non-character key from the soft keyboard to the remote desktop. A chord needs a
 *  modifier held down across both halves, which a soft keyboard cannot express, so it is left to
 *  the person's physical keyboard and reports false. */
export function sendSoftKey(client: RFB, event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  const keysym = NAMED_KEYSYMS[event.key];
  if (keysym === undefined) return false;
  client.sendKey(keysym, event.key, true);
  client.sendKey(keysym, event.key, false);
  return true;
}
