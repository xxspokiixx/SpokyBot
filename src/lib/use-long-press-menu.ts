import { useEffect, useState, type PointerEventHandler } from "react";

// Match the threshold MessageActions uses (MessageActions.tsx): below Chrome's
// native long-press handling, which fires contextmenu around 500 ms on Android
// (Chrome 108+), so the app-owned menu wins the gesture.
export const LONG_PRESS_MS = 450;

// A move past this size means scroll intent, mirroring MessageActions.
const PRESS_CANCEL_PX = 10;
// The click a browser synthesizes from a long-press release lands wherever the
// finger lifted, which may be a menu item; claims stay active this long after
// pointerup so it is swallowed instead of activating something under it.
const RELEASE_SUPPRESS_MS = 700;

const PRESS_THROUGH = "a, input, textarea, select, summary, label, [contenteditable=true]";

export type LongPressPoint = { x: number; y: number };

type LongPressEventLike = {
  clientX: number;
  clientY: number;
  pointerType: string;
  target: EventTarget | null;
  currentTarget: Element;
};

export type LongPressDetector = {
  down: (event: LongPressEventLike) => void;
  move: (event: { clientX: number; clientY: number }) => void;
  up: () => void;
  cancel: () => void;
  leave: () => void;
  /** Whether the gesture still owns this event type and callers must not react to it. */
  claims: (type: string) => boolean;
  dispose: () => void;
};

export type LongPressOptions = {
  onOpen: (point: LongPressPoint, element: EventTarget | null) => void;
  delayMs?: number;
};

/**
 * The state machine behind useLongPressMenu. Touch and pen only — a mouse
 * press never enters the machine, so right-click stays the desktop path.
 * While a gesture holds, window capture listeners swallow the browser's own
 * contextmenu; after release they swallow the synthesized click and dblclick.
 */
export function createLongPressDetector({ onOpen, delayMs = LONG_PRESS_MS }: LongPressOptions): LongPressDetector {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  let origin: LongPressPoint | null = null;
  let pressedElement: Element | null = null;
  // until: number counters (release suppression window); Infinity while the finger is still down.
  let fired: { point: LongPressPoint; until: number } | null = null;

  const holding = () => fired?.until === Infinity;
  const claiming = () => fired !== null && (holding() || Date.now() < fired.until);

  const releaseGuards = () => {
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = null;
    window.removeEventListener("click", guard, true);
    window.removeEventListener("dblclick", guard, true);
    window.removeEventListener("contextmenu", guard, true);
  };

  function guard(event: Event) {
    if (!claims(event.type)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  const installGuards = () => {
    window.addEventListener("click", guard, true);
    window.addEventListener("dblclick", guard, true);
    window.addEventListener("contextmenu", guard, true);
  };

  const clearPress = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    origin = null;
    pressedElement = null;
  };

  const release = () => {
    clearPress();
    if (fired?.until !== Infinity) return;
    fired.until = Date.now() + RELEASE_SUPPRESS_MS;
    if (releaseTimer) clearTimeout(releaseTimer);
    // A new press may hold again; leave the guards installed whenever claiming.
    releaseTimer = setTimeout(() => {
      if (!claiming()) releaseGuards();
    }, RELEASE_SUPPRESS_MS);
  };

  const fire = () => {
    timer = null;
    const point = origin;
    if (!point) return;
    fired = { point, until: Infinity };
    installGuards();
    onOpen(point, pressedElement);
  };

  const down = (event: LongPressEventLike) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    if (holding()) return;
    if (!pressOpensMenu(event)) return;
    clearPress();
    origin = { x: event.clientX, y: event.clientY };
    pressedElement = event.currentTarget instanceof Element ? event.currentTarget : null;
    timer = setTimeout(fire, delayMs);
  };

  const move = (event: { clientX: number; clientY: number }) => {
    if (!timer || !origin) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) <= PRESS_CANCEL_PX) return;
    clearPress();
  };

  const claims = (type: string): boolean => {
    if (!claiming()) return false;
    // While the finger is still down only the contextmenu is claimed: taps by a
    // second finger must reach the just-opened menu.
    if (type === "click" || type === "dblclick") return !holding();
    return true;
  };

  return {
    down,
    move,
    up: release,
    cancel: release,
    leave: clearPress,
    claims,
    dispose: () => {
      clearPress();
      fired = null;
      releaseGuards();
    },
  };
}

/**
 * Links and form controls own their long-press interactions (selection, link
 * menus); a nested button does not — on a touch screen holding the row's
 * own "…" button or a section toggle opens the same menu the row would.
 */
function pressOpensMenu(event: LongPressEventLike): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return true;
  return target.closest(PRESS_THROUGH) === null;
}

export type LongPressProps = {
  onPointerDown: PointerEventHandler<HTMLElement>;
  onPointerMove: PointerEventHandler<HTMLElement>;
  onPointerUp: PointerEventHandler<HTMLElement>;
  onPointerCancel: PointerEventHandler<HTMLElement>;
  onPointerLeave: PointerEventHandler<HTMLElement>;
};

/**
 * Long-press menu trigger for rows that already open a context menu on
 * right-click: pointer handlers to spread on the row element, no other props
 * changed. The callback receives the press point so the menu opens where the
 * finger pressed.
 */
export function useLongPressMenu(onOpen: (point: LongPressPoint, element: EventTarget | null) => void): LongPressProps {
  // use-long-press-menu.test.ts exercises createLongPressDetector directly; the React test
  // fixtures that render Sidebar components outside a real render stub a hook subset that
  // varies per suite, and only useState is stubbed everywhere, so this hook uses nothing but
  // useState and useEffect.
  const latest = useState(() => ({ current: onOpen }))[0];
  latest.current = onOpen;
  const [detector] = useState(() => createLongPressDetector({ onOpen: (point, element) => latest.current(point, element) }));
  useEffect(() => () => detector.dispose(), [detector]);
  return {
    onPointerDown: (event) => detector.down(event),
    onPointerMove: (event) => detector.move(event),
    onPointerUp: () => detector.up(),
    onPointerCancel: () => detector.cancel(),
    onPointerLeave: () => detector.leave(),
  };
}
