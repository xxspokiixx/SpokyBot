/** Deep links the phone shell delivers to the page as DOM CustomEvents; Electron
 * carries the same actions over its `ogb` IPC channels instead. */
export type DeepLinkEvent = "omb:chat-link" | "omb:open-settings" | "omb:package-install";

export function onDeepLinkEvent(name: DeepLinkEvent, handler: (detail: string) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (typeof detail === "string") handler(detail);
  };
  window.addEventListener(name, listener);
  // A CustomEvent fired before this listener existed is gone; the shell mirrors every
  // delivery into window.ombDeepLinkQueue so a cold-start link survives until mount.
  const queue = window.ombDeepLinkQueue ?? [];
  window.ombDeepLinkQueue = queue.filter(([event]) => event !== name);
  for (const [event, detail] of queue) {
    if (event === name && typeof detail === "string") handler(detail);
  }
  return () => window.removeEventListener(name, listener);
}
