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
  /** A saved server's page only, on a click: switches the window to This computer, which finishes the Cloud Pro popup's click. */
  thisComputer(): Promise<boolean>;
  /** This computer's page only: true once, right after a saved server's page switched the window here. */
  takeHandoff(): Promise<boolean>;
}
/** This computer's page only: the desktop's own switch, the same on every port its page is served from. */
export interface DesktopAnalyticsBridge {
  /** null until a choice is saved. */
  enabled(): boolean | null;
  set(enabled: boolean): Promise<void>;
}
export interface DesktopPrefs {
  seen(): string[];
  markSeen(id: string): void;
  shown(id: string): boolean;
  analytics(): boolean | null;
  setAnalytics(enabled: boolean): void;
}
export declare function jsonFile(file: string): { read(): unknown; write(value: unknown): void };
export declare function createDesktopPrefs(options: { read(): unknown; write(value: unknown): void; now?: () => number }): DesktopPrefs;
export declare function registerDesktopPrefs(options: {
  ipcMain: { handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void; on(channel: string, listener: (event: { returnValue?: unknown }) => void): void };
  read(): unknown;
  write(value: unknown): void;
  page(event: unknown): "local" | "server" | null;
  cloudOffered(): Promise<boolean>;
  thisComputer(): Promise<boolean>;
  now?: () => number;
}): void;
