// How many app frames run at once on the desktop, and which ones
// (docs/superpowers/specs/2026-10-14-chat-apps-design.md, "Performance"):
// at most three live frames per window. A row asks for its frame when it
// comes within 300px of the viewport; when the pool is full, the frame seen
// least recently is torn down first (ui/resource-teardown, at most a second)
// and only then does the new one mount, so the count never goes over. A row
// whose frame is gone keeps its chrome and a box at its last height.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export const APP_POOL_LIMITS = {
  /** Live frames per window. */
  live: 3,
  /** A row this close to the viewport counts as visible (px). */
  marginPx: 300,
  /** Only this many of a thread's newest app rows mount by themselves. */
  autoMountNewest: 20,
} as const;

export interface AppPoolMember {
  /** Give the slot back: tear the frame down. Resolves once it is gone. */
  evict(): Promise<void>;
}

interface Slot {
  member: AppPoolMember;
  visible: boolean;
  /** When the row was last in view: now while it is, else when it left. */
  seenAt: number;
}

export interface AppPool {
  /** Mount `key`'s frame: resolves once there is room (another frame may be
   * torn down first). Resolves false when the request was withdrawn. */
  acquire(key: string, member: AppPoolMember): Promise<boolean>;
  /** The row came into view, or left it. */
  seen(key: string, visible: boolean): void;
  /** The frame is gone (unmounted, collapsed, or the row left the thread). */
  release(key: string): void;
  /** Keys holding a slot, for tests and the verification recipe. */
  live(): string[];
}

export function createAppPool(options: { limit?: number; now?: () => number } = {}): AppPool {
  const limit = Math.max(1, options.limit ?? APP_POOL_LIMITS.live);
  const now = options.now ?? (() => Date.now());
  const slots = new Map<string, Slot>();
  /** Requests waiting for room, oldest first. */
  const waiting: Array<{ key: string; member: AppPoolMember; resolve(granted: boolean): void }> = [];
  /** Keys being torn down to make room: they still count. */
  const leaving = new Set<string>();
  const visibility = new Map<string, { visible: boolean; at: number }>();

  /** The slot to give up: a row out of view, the one that left it longest
   * ago; else the visible one that came into view first. */
  const victim = (except: ReadonlySet<string>): string | undefined => {
    let best: string | undefined;
    let bestScore = Infinity;
    for (const [key, slot] of slots) {
      if (except.has(key) || leaving.has(key)) continue;
      // rows out of view always go before rows in view
      const score = (slot.visible ? 1e15 : 0) + slot.seenAt;
      if (score < bestScore) { best = key; bestScore = score; }
    }
    return best;
  };

  const pump = () => {
    // Grant while there is room. A frame being torn down still holds its slot.
    while (waiting.length && slots.size < limit) {
      const next = waiting.shift()!;
      const seen = visibility.get(next.key);
      slots.set(next.key, { member: next.member, visible: seen?.visible ?? true, seenAt: seen?.at ?? now() });
      next.resolve(true);
    }
    // Make room: one teardown per waiting request not already covered by one.
    const asking = new Set(waiting.map((entry) => entry.key));
    for (let needed = waiting.length - leaving.size; needed > 0; needed -= 1) {
      const key = victim(asking);
      if (!key) break;
      leaving.add(key);
      void slots.get(key)!.member.evict().catch(() => {}).finally(() => {
        leaving.delete(key);
        slots.delete(key);
        pump();
      });
    }
  };

  return {
    acquire(key, member) {
      if (slots.has(key) && !leaving.has(key)) {
        slots.get(key)!.member = member;
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve) => {
        const existing = waiting.findIndex((entry) => entry.key === key);
        if (existing !== -1) waiting.splice(existing, 1)[0]!.resolve(false);
        waiting.push({ key, member, resolve });
        pump();
      });
    },
    seen(key, visible) {
      const at = now();
      visibility.set(key, { visible, at });
      const slot = slots.get(key);
      if (slot) { slot.visible = visible; slot.seenAt = at; }
    },
    release(key) {
      const index = waiting.findIndex((entry) => entry.key === key);
      if (index !== -1) waiting.splice(index, 1)[0]!.resolve(false);
      visibility.delete(key);
      if (leaving.has(key)) return;
      if (slots.delete(key)) pump();
    },
    live: () => [...slots.keys()],
  };
}

/** The window's pool. */
export const appPool: AppPool = createAppPool();

/**
 * One row's place in the pool. `auto` rows ask for a frame each time they
 * come into view; the others (older rows, a collapsed app) only when the
 * person asks (`open`). `evict` is the row's own teardown.
 */
export function useAppPoolSlot(args: {
  key: string;
  target: RefObject<HTMLElement | null>;
  auto: boolean;
  evict(): Promise<void>;
  pool?: AppPool;
}): { live: boolean; open(): void; close(): void } {
  const pool = args.pool ?? appPool;
  const { key, target, auto } = args;
  const [live, setLive] = useState(false);
  const evictRef = useRef(args.evict);
  evictRef.current = args.evict;
  const member = useRef<AppPoolMember>({
    evict: async () => {
      await evictRef.current();
      setLive(false);
    },
  });
  const request = useRef(0);

  const open = useCallback(() => {
    const ask = ++request.current;
    void pool.acquire(key, member.current).then((granted) => {
      if (granted && ask === request.current) setLive(true);
    });
  }, [pool, key]);

  const close = useCallback(() => {
    request.current += 1;
    pool.release(key);
    setLive(false);
  }, [pool, key]);

  useEffect(() => {
    const element = target.current;
    if (!element) return;
    // No observer (a test page): the row counts as in view.
    if (typeof IntersectionObserver === "undefined") {
      pool.seen(key, true);
      if (auto) open();
      return;
    }
    let wasVisible = false;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      pool.seen(key, visible);
      // Ask on the way in only: a frame torn down while in view (the pool
      // needed its slot) waits for the next time it is scrolled to.
      if (visible && !wasVisible && auto) open();
      wasVisible = visible;
    }, { rootMargin: `${APP_POOL_LIMITS.marginPx}px 0px` });
    observer.observe(element);
    return () => observer.disconnect();
  }, [pool, key, target, auto, open]);

  useEffect(() => () => {
    request.current += 1;
    pool.release(key);
  }, [pool, key]);

  return { live, open, close };
}
