import { useSyncExternalStore } from "react";

/** Whether a CSS media query matches, kept live as the window resizes.
 * Server rendering and test environments without `matchMedia` report
 * `fallback`, so layout decisions degrade to the wide layout they name. */
export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
      if (!media) return () => {};
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : fallback),
    () => fallback,
  );
}

/** Two static side panels (bot settings beside the inspector or computer)
 * plus the sidebar leave no usable chat column on the default 1100px
 * window; from 2xl up they fit beside a readable conversation. */
export const TWO_SIDE_PANELS_FIT = "(min-width: 1536px)";
