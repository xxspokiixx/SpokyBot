import type { createDeviceEgress } from "./device-egress.mjs";

export declare function linkUrl(origin: string, path: string): string;
export declare function runDeviceLink(options: {
  url: string;
  headers?: Record<string, string>;
  egress?: Omit<NonNullable<Parameters<typeof createDeviceEgress>[0]>, "seenAs">;
  signal?: AbortSignal;
  WebSocket?: typeof globalThis.WebSocket;
  pingMs?: number;
  silentMs?: number;
  openMs?: number;
  onOpen?: () => void;
  traffic?: () => void;
  now?: () => number;
}): Promise<{ code: number; reason: string }>;
