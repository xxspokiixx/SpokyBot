import type { installCloudSend } from "./cloud-send-main.mjs";
import type { OneHomeCloud, OneHomeView, createOneHome } from "./one-home.mjs";

export function oneHomeCloud(state: unknown): OneHomeCloud | null;

type SendDeps = Parameters<typeof installCloudSend>[0];

export function installOneHome(deps: Omit<SendDeps, "local" | "move"> & {
  /** This computer's server, as its owner. */
  localRequest(route: string, init?: RequestInit & { duplex?: "half" }): Promise<Response>;
  /** The MausBot Cloud sign-in (cloud-account.mjs). */
  account(): { state(): any; pairHome(): Promise<{ origin: string; code: string; expiresAt?: number }>; exportHome(): Promise<any> } | null;
  journalFile(): string;
  tempRoot(): string;
  lend?(projects: string[]): Promise<unknown>;
  phone?: { paired(): boolean; stop(): Promise<void>; start(): Promise<void> };
  openHome?(): void;
  openLocal?(): void;
  restart?(): void;
  version?: string;
  log?(line: string): void;
  journal?: { read(): unknown; write(value: unknown): void };
}): ReturnType<typeof installCloudSend> & {
  kick(): Promise<void>;
  away(): boolean;
  view(): OneHomeView | null;
  close(): void;
  oneHome: ReturnType<typeof createOneHome>;
};
