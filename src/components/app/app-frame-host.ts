// One app frame on the desktop, without React: the sandboxed srcdoc iframe,
// the shared bridge router wired to it, and the person's engagement with it
// (docs/superpowers/specs/2026-10-14-chat-apps-design.md, "Desktop" and
// "Engagement and limits"). AppFrame.tsx mounts it; the Electron security
// smoke (scripts/smoke-app-frames.mjs) bundles this same file, so the frame
// it probes is the one the app draws.
//
// Protocol logic lives only in shared/app-frame/bridge.ts. This file does
// what a platform must: create the frame, hand the router each `message`
// event of this window, post to the frame, and say whether the person is
// interacting with it.
import type { AppDocument } from "../../../shared/app";
import { APP_FRAME_LIMITS, createAppBridge, type AppBridgeAdapter, type AppHostContext } from "../../../shared/app-frame/bridge";

/** Security rule 1: exactly these two tokens. Never allow-same-origin,
 * allow-popups or allow-top-navigation; and no `allow` attribute. */
export const APP_FRAME_SANDBOX = "allow-scripts allow-forms";

/** Focus that entered the frame within this long after a Tab press came
 * from the keyboard. */
const TAB_ENTRY_MS = 1_000;
/** How close to the frame the host last saw the pointer, for a frame in a
 * process of its own (px). */
const NEAR_PX = 40;

export interface AppEngagement {
  /** The person is interacting with this frame now: focus entered it while
   * the pointer was over it (or by Tab), has not left it, and the window
   * has focus. */
  engaged(): boolean;
  dispose(): void;
}

/** Desktop engagement for one iframe element. Focus moving into a frame is
 * seen from outside as the window's `blur` (or the iframe element's own
 * `focus`) with the iframe as the active element; the pointer must be over
 * it then, so a frame cannot focus itself into being "engaged".
 *
 * "Over it" has two signs. A frame in this page's process gives its element
 * pointerenter and pointerleave. A frame Chromium puts in a process of its
 * own (Chrome isolates sandboxed frames; the remote web client runs there)
 * gives the page nothing once the pointer is inside it, so the page keeps
 * where it last saw the pointer: on its way in, that is at the frame's edge. */
export function trackAppEngagement(iframe: HTMLIFrameElement): AppEngagement {
  const doc = iframe.ownerDocument;
  const win = doc.defaultView;
  let over = false;
  /** Where this page last saw the pointer, in viewport coordinates; null
   * once it left the window. */
  let last: { x: number; y: number } | null = null;
  let tabAt = -Infinity;
  let entered = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const now = () => Date.now();
  const check = () => {
    timer = undefined;
    if (doc.activeElement !== iframe) return;
    if (entered) return;
    entered = over || near() || now() - tabAt <= TAB_ENTRY_MS;
  };
  const near = () => {
    if (!last) return false;
    const box = iframe.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return false;
    return last.x >= box.left - NEAR_PX && last.x <= box.right + NEAR_PX && last.y >= box.top - NEAR_PX && last.y <= box.bottom + NEAR_PX;
  };
  // The active element settles after the event: look on the next turn.
  const soon = () => {
    if (timer === undefined) timer = setTimeout(check, 0);
  };
  const onEnter = () => { over = true; };
  const onLeave = () => { over = false; };
  const onKey = (event: KeyboardEvent) => { if (event.key === "Tab") tabAt = now(); };
  const onMove = (event: PointerEvent) => { last = { x: event.clientX, y: event.clientY }; };
  const onGone = () => { last = null; };
  const onLeft = () => { entered = false; };
  iframe.addEventListener("pointerenter", onEnter);
  iframe.addEventListener("pointerleave", onLeave);
  iframe.addEventListener("focus", soon);
  iframe.addEventListener("blur", onLeft);
  doc.addEventListener("keydown", onKey, true);
  doc.addEventListener("pointermove", onMove, { capture: true, passive: true });
  doc.documentElement.addEventListener("mouseleave", onGone);
  win?.addEventListener("blur", soon);
  // Focus came back to the app (or to another frame): no longer engaged.
  win?.addEventListener("focus", onLeft);
  return {
    engaged: () => {
      if (doc.activeElement !== iframe) entered = false;
      return entered && doc.activeElement === iframe && doc.hasFocus();
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      iframe.removeEventListener("pointerenter", onEnter);
      iframe.removeEventListener("pointerleave", onLeave);
      iframe.removeEventListener("focus", soon);
      iframe.removeEventListener("blur", onLeft);
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointermove", onMove, { capture: true });
      doc.documentElement.removeEventListener("mouseleave", onGone);
      win?.removeEventListener("blur", soon);
      win?.removeEventListener("focus", onLeft);
    },
  };
}

/** What the platform does for the router, less what this file does itself
 * (post, engagement, the clock). */
export type AppFrameAdapter = Omit<AppBridgeAdapter, "post" | "engaged" | "now">;

export interface AppFrameHostOptions {
  /** The element the frame goes in. */
  container: HTMLElement;
  doc: AppDocument;
  /** The frame's accessible name. */
  title: string;
  /** Starting height (px), before the View reports its own. */
  height: number;
  /** Theme, skin, width and maxHeight (containerDimensions.maxHeight is the clamp). */
  hostContext: AppHostContext;
  hostVersion: string;
  adapter: AppFrameAdapter;
  log?(params: unknown): void;
}

export interface AppFrameHost {
  readonly iframe: HTMLIFrameElement;
  engaged(): boolean;
  contextChanged(partial: AppHostContext): void;
  /** ui/resource-teardown (at most a second), then the frame is removed. */
  teardown(): Promise<void>;
  /** Remove now, without asking the View. */
  destroy(): void;
}

/** The frame element, as rule 1 requires. Its srcdoc is set by the caller,
 * verbatim, only once the bridge listens. */
export function createAppIframe(doc: Document, title: string, height: number, theme?: "light" | "dark"): HTMLIFrameElement {
  const iframe = doc.createElement("iframe");
  iframe.setAttribute("sandbox", APP_FRAME_SANDBOX);
  iframe.setAttribute("referrerpolicy", "no-referrer");
  iframe.setAttribute("title", title);
  iframe.setAttribute("data-app-frame", "");
  const style = iframe.style;
  style.display = "block";
  style.width = "100%";
  style.height = `${Math.max(APP_FRAME_LIMITS.minHeight, Math.round(height))}px`;
  style.border = "0";
  style.background = "transparent";
  // The frame's page takes the theme on initialize; matching it here keeps
  // the frame see-through instead of painting the other scheme's canvas.
  if (theme) style.colorScheme = theme;
  return iframe;
}

export function mountAppFrame(options: AppFrameHostOptions): AppFrameHost {
  const { container, doc } = options;
  const ownerDocument = container.ownerDocument;
  const win = ownerDocument.defaultView;
  const iframe = createAppIframe(ownerDocument, options.title, options.height, options.hostContext.theme);
  const engagement = trackAppEngagement(iframe);
  let gone = false;
  const bridge = createAppBridge({
    doc,
    hostContext: options.hostContext,
    hostVersion: options.hostVersion,
    source: () => iframe.contentWindow,
    ...(options.log ? { log: options.log } : {}),
    adapter: {
      ...options.adapter,
      // An opaque origin cannot be named: "*" is the only target there is.
      post: (message) => iframe.contentWindow?.postMessage(message, "*"),
      resize: (height) => {
        iframe.style.height = `${height}px`;
        options.adapter.resize(height);
      },
      engaged: () => engagement.engaged(),
      now: () => Date.now(),
    },
  });
  // Security rule 9 is the router's: it drops any event whose source is not
  // this frame's window, and anything that is not JSON-RPC of at most 1 MB.
  const onMessage = (event: MessageEvent) => bridge.handleMessage({ source: event.source, data: event.data });
  win?.addEventListener("message", onMessage);
  // The router listens before the frame can speak: it loads on insertion.
  iframe.srcdoc = doc.srcdoc;
  container.appendChild(iframe);

  const destroy = () => {
    if (gone) return;
    gone = true;
    win?.removeEventListener("message", onMessage);
    bridge.dispose();
    engagement.dispose();
    iframe.remove();
  };
  return {
    iframe,
    engaged: () => engagement.engaged(),
    contextChanged: (partial) => {
      if (gone) return;
      // The frame's scheme follows the theme, as at creation: a View that
      // adopts the new theme in a frame still marked with the old one gets an
      // opaque canvas from Chromium instead of the card showing through.
      if (partial.theme) iframe.style.colorScheme = partial.theme;
      bridge.contextChanged(partial);
    },
    async teardown() {
      if (gone) return;
      await bridge.teardown();
      destroy();
    },
    destroy,
  };
}
