export { DESKTOP_PORTS } from "./desktop-ports.mjs";
export declare const DESKTOP_NOTICES: readonly string[];
export declare const HANDOFF_MS: number;
export interface DesktopNoticesState {
  /** Notices this desktop has shown and someone closed, on whichever page of its window. */
  seen: string[];
  /** This desktop sells MausBot Cloud: the installed app, not a branded build, not connected to another computer. */
  cloud: boolean;
}
/** On every page this desktop's window shows: this computer's, My Cloud's or another saved server's. */
export interface DesktopNoticesBridge {
  state(): Promise<DesktopNoticesState>;
  seen(id: string): Promise<void>;
  /** True the first time today the notice counts as shown on this desktop. */
  shown(id: string): Promise<boolean>;
  /**
   * A server's page only, right after a click on it: switches the window to This computer, once a launch while the Cloud
   * Pro popup is unseen, where the popup shows again. With "manage", from My Cloud's own page only, This computer's page
   * opens Settings → MausBot Cloud instead, as that popup's Manage plan.
   */
  thisComputer(then?: "manage"): Promise<boolean>;
  /** This computer's page only: true from My Cloud's page handing over its Manage plan click until the popup is seen, for a
   * short while. */
  handoff(): Promise<boolean>;
}
/** The desktop's own switch, the same on every port its page is served from. */
export interface DesktopAnalyticsBridge {
  /** null until a choice is saved; a server's page is told only false, when this desktop turned analytics off. */
  enabled(): boolean | null;
  /** This computer's page only. */
  set?(enabled: boolean): Promise<void>;
}
export interface DesktopPrefs {
  seen(): string[];
  markSeen(id: string): void;
  shown(id: string): boolean;
  analytics(): boolean | null;
  setAnalytics(enabled: boolean): void;
}
type Files = Pick<typeof import("node:fs"), "readFileSync" | "writeFileSync" | "renameSync" | "rmSync">;
export declare function jsonFile(file: string, files?: Files): { read(): unknown; write(value: unknown): void };
export declare function createDesktopPrefs(options: { read(): unknown; write(value: unknown): void; now?: () => number }): DesktopPrefs;
export declare function registerDesktopPrefs(options: {
  ipcMain: { handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void; on(channel: string, listener: (event: { returnValue?: unknown }) => void): void };
  read(): unknown;
  write(value: unknown): void;
  page(event: unknown): "local" | "cloud" | "server" | null;
  cloudOffered(): Promise<boolean>;
  thisComputer(): Promise<boolean>;
  now?: () => number;
}): void;
