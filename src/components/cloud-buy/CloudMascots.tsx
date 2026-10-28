// MausBot Cloud's mark: three of the app's own Maus bots, small, beside the Cloud's name.
import { memo, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { MausAvatar } from "@/components/Avatar";
import type { MausColor, MausState } from "@/lib/mascot";
import { reducedMotion } from "@/lib/onboarding";

/** Each bot keeps one calm state, which the mascot animates by itself (its faces, blinks and a slow bob or sway). */
const CREW: readonly { color: MausColor; state: MausState }[] = [
  { color: "orange", state: "working" },
  { color: "pink", state: "idle" },
  { color: "green", state: "thinking" },
];

function subscribeReducedMotion(changed: () => void) {
  const query = globalThis.window?.matchMedia?.("(prefers-reduced-motion: reduce)");
  query?.addEventListener?.("change", changed);
  const root = globalThis.document?.documentElement;
  const hook = root && typeof MutationObserver === "function" ? new MutationObserver(changed) : null;
  if (root) hook?.observe(root, { attributes: true, attributeFilter: ["data-reduced-motion"] });
  return () => {
    query?.removeEventListener?.("change", changed);
    hook?.disconnect();
  };
}

function useInView(target: RefObject<HTMLElement | null>) {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const node = target.current;
    if (!node || typeof IntersectionObserver !== "function") return;
    const watch = new IntersectionObserver(entries => setInView(entries.at(-1)?.isIntersecting ?? true));
    watch.observe(node);
    return () => watch.disconnect();
  }, [target]);
  return inView;
}

/** Hidden from screen readers: the name beside it says what it is. */
export const CloudMascots = memo(function CloudMascots({ size = 20 }: { size?: number }) {
  const root = useRef<HTMLSpanElement>(null);
  const inView = useInView(root);
  const live = !useSyncExternalStore(subscribeReducedMotion, reducedMotion, reducedMotion);
  const moving = live && inView;
  return <span ref={root} aria-hidden="true" data-cloud-mascots="" data-paused={moving ? undefined : ""} className="inline-flex shrink-0 items-center gap-0.5">
    {CREW.map(({ color, state }) => <MausAvatar key={color} color={color} state={state} size={size} animated={moving} trackPointer={false} />)}
  </span>;
});
