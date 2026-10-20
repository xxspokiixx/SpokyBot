export declare const DEFAULT_FOLDERS: readonly string[];
export interface PageLending {
  available: boolean;
  on: boolean;
  /** "lent", "busy", "starting", or why it isn't working (computer-sharing.mjs's problem codes). */
  status: string | null;
  folders: Array<{ name: string; write: boolean }>;
  screen: boolean;
}
export function pageLending(snapshot: unknown): PageLending;
export function existingFolders<T>(folders: unknown[], validate: (folders: unknown[]) => Promise<T[]>): Promise<T[]>;
/** What the native confirmation says before My Cloud's page turns lending on: exactly what goes. */
export function grantSentence(grant: { folders: Array<{ name: string; write: boolean }>; screen: boolean }): string;
/** A refusal the page says plainly, never with Try again: `lending-refused:<code>` in the IPC error's message. */
export declare const LENDING_REFUSED: string;
export function usualFolderPaths(getPath: (name: string) => string, home: string): Array<{ path: string; named: string }>;
export function usualFolders<T extends { path: string }>(entries: Array<string | { path: string; named: string | null }>, validate: (folders: Array<{ id: string; path: string; write: boolean }>) => Promise<T[]>): Promise<T[]>;
export function installCloudLending(deps: Record<string, unknown>): void;
