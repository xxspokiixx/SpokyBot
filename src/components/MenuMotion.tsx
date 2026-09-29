import { useLayoutEffect, useRef, useState } from "react";

/** Same length as `--animate-pop-in` in styles.css. */
export const MENU_MOTION_MS = 200;

function reducedMotion(): boolean {
  if (typeof document === "undefined") return false;
  if (document.documentElement.dataset.reducedMotion === "true") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type Phase = "closed" | "open" | "closing";

/** Keep a menu mounted through the same 200ms pop it uses to open, so close
 * is the open motion played backwards. */
export function useMenuMotion(open: boolean): { shown: boolean; closing: boolean; className: string } {
  const [phase, setPhase] = useState<Phase>(open ? "open" : "closed");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  // Open on the same render the trigger flips, so the pop starts with the
  // menu instead of one frame later.
  if (open && phase !== "open") setPhase("open");

  useLayoutEffect(() => {
    if (open) return;
    if (phaseRef.current === "closed") return;
    if (reducedMotion()) {
      setPhase("closed");
      return;
    }
    setPhase("closing");
    const timer = window.setTimeout(() => setPhase("closed"), MENU_MOTION_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  return {
    shown: phase !== "closed",
    closing: phase === "closing",
    className: phase === "closing" ? "animate-pop-out pointer-events-none" : "animate-pop-in",
  };
}

/** Remember the last open payload so a menu can finish closing after its
 * owner has already cleared the state that positioned it. */
export function useHeldMenuMotion<T>(value: T | null): {
  shown: boolean;
  closing: boolean;
  className: string;
  value: T | null;
} {
  const motion = useMenuMotion(value != null);
  const held = useRef<T | null>(value);
  if (value != null) held.current = value;
  return { ...motion, value: value ?? held.current };
}
