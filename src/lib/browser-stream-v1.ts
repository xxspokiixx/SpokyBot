// The v1 live view (server-sent events, one POST per action) behind the v2 stream client's interface, so one panel
// speaks both: v1 is what agent-browser serves, and what an older server or companion still offers.
import type { ControlTransport } from "./browser-control";
import { t } from "./i18n";
import type { PreviewStreamClient, PreviewStreamControl, PreviewStreamEvents, PreviewStreamInput } from "./browser-stream-client";

type Body = Record<string, unknown>;
export type LivePost = (body: Body, viewerId: string) => Promise<unknown>;

export interface LiveStreamClient extends PreviewStreamClient {
  readonly transport: ControlTransport;
}

const RECONNECT_DELAYS = [1_000, 2_000, 4_000, 8_000, 15_000];
const QUEUE_LIMIT = 32;
const CHAR_LIMIT = 4_096;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, Number.isFinite(value) ? value : 0));
const delta = (value: number) => clamp(value, -10_000, 10_000);

/** Frame metadata can describe the window, not the page: headless Chrome reports 1280×720 for a 1280×577 page. */
export function browserFrameSize(imageWidth: number, imageHeight: number, width: number, height: number) {
  const depicted = imageHeight * width / imageWidth;
  return Math.abs(depicted - height) <= Math.max(1, width / imageWidth) ? { width, height } : { width, height: Math.round(depicted) };
}

/** Width and height from a JPEG's start-of-frame segment. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  for (let at = 2; at + 9 < bytes.length;) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    if (marker >= 0xc0 && marker <= 0xc2) return { height: (bytes[at + 5]! << 8) | bytes[at + 6]!, width: (bytes[at + 7]! << 8) | bytes[at + 8]! };
    at += 2 + ((bytes[at + 2]! << 8) | bytes[at + 3]!);
  }
  return null;
}

/** A v2 message as the v1 action it stands for; null for what v1 has no action for. */
export function liveAction(input: PreviewStreamInput): Body | Body[] | null {
  switch (input.type) {
    case "mouse":
      return {
        type: "input_mouse", eventType: input.action === "down" ? "mousePressed" : input.action === "up" ? "mouseReleased" : "mouseMoved",
        x: clamp(input.x, 0, 8192), y: clamp(input.y, 0, 8192), button: input.button,
        clickCount: Math.round(clamp(input.clickCount, 0, 3)), modifiers: input.modifiers,
      };
    case "wheel":
      return { type: "input_mouse", eventType: "mouseWheel", x: clamp(input.x, 0, 8192), y: clamp(input.y, 0, 8192), button: "none", deltaX: delta(input.deltaX), deltaY: delta(input.deltaY), modifiers: input.modifiers };
    case "key":
      if (!input.key) return null;
      return {
        type: "input_keyboard", eventType: input.action === "up" ? "keyUp" : "keyDown", key: input.key.slice(0, 64), code: input.code.slice(0, 64),
        windowsVirtualKeyCode: Math.round(clamp(input.keyCode ?? 0, 0, 255)), modifiers: input.modifiers,
        ...(input.text !== undefined ? { text: input.text } : {}),
      };
    case "text": {
      const chunks: Body[] = [];
      for (let at = 0; at < input.text.length; at += CHAR_LIMIT) chunks.push({ type: "input_keyboard", eventType: "char", text: input.text.slice(at, at + CHAR_LIMIT) });
      return chunks;
    }
    case "navigate": return { type: "navigate", url: input.url };
    case "history": return { type: input.delta < 0 ? "back" : "forward" };
    case "reload": return { type: "reload" };
    case "tabSelect": return { type: "tab-select", tabId: input.tabId };
    case "tabClose": return { type: "tab-close", tabId: input.tabId };
    case "tabNew": return input.url ? { type: "tab-new", url: input.url } : { type: "tab-new" };
    case "restart": return { type: "restart" };
    default: return null;
  }
}

const movement = (body: Body) => body.type === "input_mouse" && (body.eventType === "mouseMoved" || body.eventType === "mouseWheel");
/** What still goes once input has halted: releases, so nothing stays held, and toolbar actions. */
const afterHalt = (body: Body) => (body.type === "input_mouse" && body.eventType === "mouseReleased") || (body.type === "input_keyboard" && body.eventType === "keyUp")
  || (body.type !== "input_mouse" && body.type !== "input_keyboard");

/** One request at a time: key and button order is kept, movement coalesced, and a reconnect never replays old input. */
export function createLiveInputQueue(send: (body: Body) => Promise<unknown>, onError: (cause: unknown) => void) {
  let queue: Body[] = [];
  let active: Promise<void> | null = null;
  let generation = 0;
  let stopped = false;
  const halt = (cause: unknown) => {
    queue = queue.filter(afterHalt);
    if (!stopped) { stopped = true; onError(cause); }
  };
  const run = () => {
    if (active || !queue.length) return;
    const current = generation;
    active = (async () => {
      while (current === generation && queue.length) {
        const body = queue.shift()!;
        try { await send(body); }
        catch (cause) { if (current === generation) halt(cause); }
      }
    })().finally(() => { active = null; run(); });
  };
  return {
    enqueue(body: Body) {
      if (stopped && !afterHalt(body)) return;
      const last = queue.at(-1);
      if (last && movement(body) && last.type === body.type && last.eventType === body.eventType && last.modifiers === body.modifiers && last.button === body.button) {
        queue[queue.length - 1] = body.eventType === "mouseWheel"
          ? { ...body, deltaX: delta(Number(last.deltaX ?? 0) + Number(body.deltaX ?? 0)), deltaY: delta(Number(last.deltaY ?? 0) + Number(body.deltaY ?? 0)) }
          : { ...body };
        return;
      }
      if (queue.length >= QUEUE_LIMIT) {
        if (movement(body)) return;
        const replaceable = queue.findIndex(movement);
        if (replaceable >= 0) queue.splice(replaceable, 1);
        else {
          halt(new Error(t("browser.input.tooSlow")));
          if (!afterHalt(body) || queue.length >= QUEUE_LIMIT) return;
        }
      }
      queue.push({ ...body });
      run();
    },
    async drain() {
      queue = queue.filter((body) => !movement(body));
      while (active || queue.length) { run(); await active; }
    },
    async settle() { while (active || queue.length) { run(); await active; } },
    size: () => queue.length + (active ? 1 : 0),
    stopped: () => stopped,
    clear() { generation++; queue = []; stopped = false; },
  };
}

/** v1's {held, owned, controlling} in v2's words. */
export function liveControl(value: { held?: unknown; owned?: unknown; controlling?: unknown }, generation: number): PreviewStreamControl {
  const controller = value.owned === true ? (value.controlling === true ? "you" : "agent") : value.held === true ? "another-viewer" : "unclaimed";
  return { canOperate: true, controller, generation, dialog: null };
}

/**
 * Opens the v1 view of a bot's browser. Frames come as base64 JPEG and wait for an acknowledgement each; the view
 * reconnects a few times after a dropped connection, never replaying input, and then stops.
 */
export function createLiveStreamClient(botId: string, events: PreviewStreamEvents, post: LivePost): LiveStreamClient {
  let stopped = false;
  let source: EventSource | null = null;
  let viewerId = "";
  let attempts = 0;
  let generation = 0;
  let control: PreviewStreamControl | null = null;
  let viewport: { width: number; height: number } | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const queue = createLiveInputQueue((body) => (viewerId ? post(body, viewerId) : Promise.reject(new Error("Open the browser connection first."))), (cause) => {
    events.onMessage?.({ type: "notice", message: cause instanceof Error ? cause.message : String(cause) });
  });

  const connect = () => {
    if (stopped) return;
    const live = new EventSource(`/api/bots/${encodeURIComponent(botId)}/browser/live`);
    source = live;
    const listen = (name: string, handler: (data: Record<string, unknown>) => void) => live.addEventListener(name, (event) => {
      if (source !== live) return;
      try { handler(JSON.parse((event as MessageEvent).data) as Record<string, unknown>); } catch {}
    });
    listen("waiting", () => events.onMessage?.({ type: "starting" }));
    listen("ready", (data) => {
      if (typeof data.viewerId !== "string" || !data.viewerId) return;
      viewerId = data.viewerId;
      events.onConnectedChange(true);
    });
    listen("heartbeat", () => { attempts = 0; });
    listen("frame", (data) => {
      if (!viewerId || typeof data.data !== "string" || typeof data.seq !== "number") return;
      const binary = atob(data.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const metadata = (data.metadata ?? {}) as { deviceWidth?: number; deviceHeight?: number };
      const image = jpegSize(bytes);
      if (image && metadata.deviceWidth && metadata.deviceHeight) {
        const size = browserFrameSize(image.width, image.height, metadata.deviceWidth, metadata.deviceHeight);
        if (size.width !== viewport?.width || size.height !== viewport.height) {
          viewport = size;
          events.onViewport(size);
        }
      }
      events.onFrame(bytes.buffer);
      void post({ type: "ack", seq: data.seq }, viewerId).catch(() => undefined);
    });
    listen("tabs", (data) => { if (Array.isArray(data.tabs)) events.onMessage?.({ type: "tabs", tabs: data.tabs }); });
    listen("url", (data) => { if (typeof data.url === "string") events.onMessage?.({ type: "url", url: data.url }); });
    listen("status", (data) => {
      if (viewport || !(Number(data.viewportWidth) > 0 && Number(data.viewportHeight) > 0)) return;
      viewport = { width: Number(data.viewportWidth), height: Number(data.viewportHeight) };
      events.onViewport(viewport);
    });
    listen("control", (data) => {
      const next = liveControl(data, generation);
      if (control && next.controller === control.controller) return;
      control = liveControl(data, ++generation);
      events.onControl?.(control);
    });
    live.addEventListener("error", (event) => {
      if (source !== live) return;
      let retryable = !(event instanceof MessageEvent);
      if (event instanceof MessageEvent) {
        try {
          const data = JSON.parse(event.data) as { retryable?: unknown; message?: unknown };
          retryable = data.retryable === true;
          if (typeof data.message === "string") events.onMessage?.({ type: "notice", message: data.message });
        } catch {}
      }
      live.close();
      source = null;
      const wasConnected = viewerId !== "";
      viewerId = "";
      control = null;
      queue.clear();
      if (wasConnected) events.onConnectedChange(false);
      if (stopped) return;
      const delay = retryable ? RECONNECT_DELAYS[attempts++] : undefined;
      if (delay === undefined) {
        stopped = true;
        events.onGone?.();
        return;
      }
      retry = setTimeout(connect, delay);
    });
  };
  connect();

  const send = (input: PreviewStreamInput) => {
    if (!viewerId || !control?.canOperate) return false;
    if (!["takeControl", "resize", "restart"].includes(input.type) && control.controller !== "you") return false;
    const action = liveAction(input);
    if (!action) return input.type === "resize";
    for (const body of Array.isArray(action) ? action : [action]) queue.enqueue(body);
    return true;
  };

  return {
    send,
    stop: () => {
      stopped = true;
      if (retry !== null) clearTimeout(retry);
      source?.close();
      source = null;
      viewerId = "";
      queue.clear();
    },
    transport: {
      send: (input) => {
        const action = viewerId ? liveAction(input) : null;
        if (action) for (const body of Array.isArray(action) ? action : [action]) queue.enqueue(body);
      },
      drain: () => queue.drain(),
      settle: () => queue.settle(),
      size: () => queue.size(),
      stopped: () => queue.stopped(),
      take: async () => {
        if (!viewerId) throw new Error("The browser view is not connected. Reconnect it, then try again.");
        const reply = await post({ type: "take" }, viewerId) as { waited?: unknown } | null;
        return { waited: reply?.waited === true };
      },
      release: async () => { if (viewerId) await post({ type: "release" }, viewerId); },
    },
  };
}
