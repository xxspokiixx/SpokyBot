/** What this computer's screen says while the window can't show My Cloud. `reason`: the Admin's words on why My Cloud
 * doesn't answer; `machine`: a plan problem's state; `other`: another MausBot Cloud account is signed in. */
export type HomeView =
  | { screen: "opening" | "waking" | "moving" }
  | { screen: "offline"; reason?: string }
  | { screen: "signin"; other?: true }
  | { screen: "plan"; machine: "stopped" | "payment-problem" | "failed" };

/** The window onto My Cloud once it is the person's home (preload `home`). */
export interface HomeBridge {
  /** This computer's screen only. */
  state(): Promise<HomeView>;
  onState(callback: (view: HomeView) => void): () => void;
  /** This computer's screen only: look again now. */
  retry(): Promise<HomeView>;
  /** This device's MausBot Cloud sign-in, again; on My Cloud's page only from the person's click. */
  signIn(): Promise<void>;
  /** My Cloud's own page only: its session ended, so the app signs it in again by itself. */
  repair(): Promise<void>;
}

export type Home = { kind: "computer" } | { kind: "cloud"; origin: string } | { kind: "signin"; other?: true };

export declare const HOME_SCREEN_PATH: string;
export declare const LOOK_MS: number;
export declare const RETRY_MS: readonly number[];
export declare const QUIET_MS: number;
export declare const VERSION_EVERY_MS: number;
export declare const SPLASH_HANDOFF_MS: number;
export declare const SPLASH_TEXT: Readonly<{ opening: string; waking: string }>;

export function homeOf(input: { journal?: any; frozenCloud?: string | true | null; state?: any }): Home;
export function routeOf(url: string, origin: string): string | null;

interface WindowLike { isDestroyed(): boolean; webContents: { id: number; getURL(): string; reload(): void; mainFrame?: unknown } }
type Timers = { set(work: () => void, ms: number): unknown; clear(timer: unknown): void; every(work: () => void, ms: number): unknown };

export interface HomeWindow {
  show(options?: { open?: "phone" | null }): Promise<unknown>;
  refresh(): Promise<Home>;
  view(): HomeView;
  cloudOrigin(): string | null;
  current(): Home;
  retry(): Promise<unknown>;
  signIn(): Promise<void>;
  repair(): Promise<void>;
  changed(): Promise<void>;
  responded(details: { url: string; statusCode: number; webContentsId?: number }): void;
  navigated(url: string): void;
  failed(url: string): void;
  homePage(event: unknown): boolean;
  screenPage(event: unknown): boolean;
  close(): void;
}

export function createHomeWindow(deps: {
  journal(): unknown;
  frozen(): Promise<{ frozen: boolean; cloud?: string } | null>;
  account(): { state(): any; power(): any; wakeHome(): Promise<unknown>; setWaking(on: boolean): void; pairHome(): Promise<{ origin: string; code: string; expiresAt: number }>;
    signInAgain(): Promise<unknown>; begin(): Promise<unknown> } | null;
  restored?(): Promise<unknown>;
  window(): WindowLike | null;
  ensureWindow(): void;
  localOrigin(): string;
  cookieFetch: (url: string, init?: RequestInit) => Promise<Response>;
  power: { asleep(): boolean; hold(): void; woke(): void };
  go(url: string, origin: string | null): unknown;
  showLocal(leaving: boolean): unknown;
  splash?(): { status(text: string): void } | null;
  lastInput?(): number;
  publish?(view: HomeView): void;
  versionEveryMs?: number;
  quietMs?: number;
  now?(): number;
  timers?: Timers;
  log?(line: string): void;
}): HomeWindow;

export function installHomeWindowIpc(deps: {
  ipcMain: { handle(channel: string, handler: (event: any, ...args: any[]) => unknown): void; on(channel: string, listener: (event: any) => void): void };
  homeWindow: HomeWindow;
  cloudPage(event: unknown): "local" | "cloud" | null;
}): void;
