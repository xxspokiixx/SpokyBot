// The preview pane beside the chat and the parts of its page the person pointed at, waiting in the composer.
import { useSyncExternalStore } from "react";
import { POINT_LIMITS, type PointedElement } from "../../shared/app-frame/point";

export interface PreviewTarget {
  botId: string;
  threadId: string;
  messageId: string;
}

export interface PointedChip extends PointedElement {
  id: string;
  /** The page's title when it was picked. */
  title: string;
}

interface PreviewState {
  target: PreviewTarget | null;
  /** The pane is mounted in this window, so bot pages draw as cards that open it. */
  hosts: number;
  chips: Readonly<Record<string, readonly PointedChip[]>>;
}

let state: PreviewState = { target: null, hosts: 0, chips: {} };
const listeners = new Set<() => void>();

function set(next: Partial<PreviewState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePreviewState(): PreviewState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function openPreview(target: PreviewTarget): void {
  const now = state.target;
  if (now && now.botId === target.botId && now.threadId === target.threadId && now.messageId === target.messageId) return;
  set({ target });
}

export function closePreview(): void {
  if (state.target) set({ target: null });
}

/** Returns the unmount. */
export function hostPreview(): () => void {
  set({ hosts: state.hosts + 1 });
  return () => set({ hosts: Math.max(0, state.hosts - 1) });
}

const EMPTY: readonly PointedChip[] = [];

export function usePointedChips(threadId: string): readonly PointedChip[] {
  return useSyncExternalStore(subscribe, () => state.chips[threadId] ?? EMPTY, () => EMPTY);
}

/** The same part picked twice stays one chip; past the limit the oldest goes. */
export function addPointedChip(threadId: string, chip: Omit<PointedChip, "id">): void {
  const kept = (state.chips[threadId] ?? EMPTY).filter((each) => !(each.appId === chip.appId && each.selector === chip.selector));
  const next = [...kept, { ...chip, id: crypto.randomUUID() }].slice(-POINT_LIMITS.perMessage);
  set({ chips: { ...state.chips, [threadId]: next } });
}

export function removePointedChip(threadId: string, id: string): void {
  const list = state.chips[threadId];
  if (!list?.some((chip) => chip.id === id)) return;
  set({ chips: { ...state.chips, [threadId]: list.filter((chip) => chip.id !== id) } });
}

/** The chips a send carries, taken out of the composer; `restore` puts them back when the send fails. */
export function takePointedChips(threadId: string): { pointed: PointedElement[]; restore(): void } | null {
  const list = state.chips[threadId];
  if (!list?.length) return null;
  const { [threadId]: _taken, ...rest } = state.chips;
  set({ chips: rest });
  return {
    pointed: list.map(({ id: _id, title: _title, ...element }) => element),
    restore: () => set({ chips: { ...state.chips, [threadId]: [...list, ...(state.chips[threadId] ?? EMPTY)].slice(-POINT_LIMITS.perMessage) } }),
  };
}

export function forgetPreviewState(): void {
  state = { target: null, hosts: 0, chips: {} };
  for (const listener of listeners) listener();
}
