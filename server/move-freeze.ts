// This computer's copy once the person's bots moved to their own Cloud: one marker, moved.json in the data folder. A
// frozen server admits no turns, runs no schedules, app events or memory upkeep, and answers every change but the
// move's own with one sentence. Nothing in the workspace is edited, so lifting the marker leaves this computer exactly
// as it was. A Cloud that ended, started only so its owner can take their things home (OMB_CLOUD_EXPORT_ONLY=1), runs
// frozen the same way and is never lifted.
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";

export const MOVED_REFUSAL = "This bot lives on My Cloud now.";
/** The one page a frozen copy serves: the desktop app's screen while My Cloud can't be opened (electron/home-window.mjs). */
export const HOME_SCREEN = "/home";
/** A path whose last part has an extension is a file of the page (a script, a picture), never a page. */
const FILE = /\.[A-Za-z0-9]+$/u;
export const ENDED_REFUSAL = "My Cloud has ended. It is open only so you can take your things home.";

/** What a frozen server still changes: the freeze itself, the move's reads and lets-go, signing in and out, the backup
 * that takes things home, the Admin's signed routes, Files and the computers lent to it. */
const STILL_CHANGES = /^\/api\/(?:move\/|cloud-send\/|auth\/|workspace-backup\/|cloud\/|sync\/|shared-computers\/)/u;
const READS = new Set(["GET", "HEAD", "OPTIONS"]);
/** What a frozen copy keeps once its workspace is deleted: the marker, this server's identity, Files, downloaded tools
 * and caches, and its own runtime files. Everything else, credentials included, is the person's workspace. */
const DEVICE_STATE = new Set(["moved.json", "environment-id", "sync", "tools", "cache", ".cache", "tmp", ".tmp", "dist-native", "tunnel-runtime",
  ".openmausbot-server-child", "openmausbot-server.lease"]);
const kept = (name: string) => DEVICE_STATE.has(name) || name.startsWith("openmausbot-server.lease.");

export type MoveFreeze = ReturnType<typeof createMoveFreeze>;

export function createMoveFreeze({ dataDir, exportOnly = false }: { dataDir: string; exportOnly?: boolean }) {
  const file = join(dataDir, "moved.json");
  let frozen = exportOnly || existsSync(file);
  const named = (): string | null => {
    try { const value: unknown = JSON.parse(readFileSync(file, "utf8")); const cloud = Reflect.get(Object(value), "cloud"); return typeof cloud === "string" ? cloud : null; } catch { return null; }
  };
  let movedTo = frozen && !exportOnly ? named() : null;
  const held: Array<{ start(): void; stop(): void }> = [];
  const refusal = () => (frozen ? (exportOnly ? ENDED_REFUSAL : MOVED_REFUSAL) : null);
  const each = (step: "start" | "stop") => {
    for (const work of held) {
      try { work[step](); } catch (error) { console.warn(`move freeze: could not ${step} a schedule (${(error as Error).message})`); }
    }
  };

  return {
    frozen: () => frozen,
    /** The Cloud this computer's bots moved to, as the freeze named it. */
    cloud: () => movedTo,
    refusal,
    /** Where a page of this computer's frozen copy goes instead: its home screen, never the frozen workspace. */
    screen(path: string): string | null {
      if (!frozen || exportOnly || path === HOME_SCREEN || FILE.test(path)) return null;
      return HOME_SCREEN;
    },
    /** Starts it now unless this server is frozen; a freeze stops it, and lifting the freeze starts it again. */
    hold(start: () => void, stop: () => void): void {
      held.push({ start, stop });
      if (!frozen) start();
    },
    assertTurns(): void {
      const said = refusal();
      if (said) throw Object.assign(new Error(said), { status: 409, code: "moved" });
    },
    /** Why a frozen server refuses this request, or null when it takes it. */
    refuses(method: string, path: string): string | null {
      return frozen && !READS.has(method.toUpperCase()) && !STILL_CHANGES.test(path) ? refusal() : null;
    },
    freeze(cloud: string | null): void {
      if (frozen) return;
      writeFileAtomic(file, JSON.stringify({ v: 1, at: Date.now(), ...(cloud ? { cloud } : {}) }), { mode: 0o600 });
      frozen = true;
      movedTo = cloud;
      each("stop");
    },
    /** Deletes this computer's copy of the workspace, credentials included, once the move is long done; only a computer
     * frozen by a move ever does. The server starts again after, frozen and empty. */
    forget(): boolean {
      if (exportOnly || !existsSync(file)) return false;
      for (const name of readdirSync(dataDir)) if (!kept(name)) rmSync(join(dataDir, name), { recursive: true, force: true });
      return true;
    },
    /** False when this server may never be lifted: a Cloud that ended. */
    unfreeze(): boolean {
      if (exportOnly) return false;
      if (!frozen) return true;
      rmSync(file, { force: true });
      frozen = false;
      movedTo = null;
      each("start");
      return true;
    },
  };
}
