// The preview pane beside the chat.
import { useSyncExternalStore } from "react";

export interface PreviewTarget {
  botId: string;
  threadId: string;
  messageId: string;
}

interface PreviewState {
  target: PreviewTarget | null;
  /** The pane is mounted in this window, so bot pages draw as cards that open it. */
  hosts: number;
}

let state: PreviewState = { target: null, hosts: 0 };
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

export function forgetPreviewState(): void {
  state = { target: null, hosts: 0 };
  for (const listener of listeners) listener();
}
