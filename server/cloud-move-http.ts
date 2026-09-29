// Move to Cloud's routes (server/cloud-move.ts, docs/cloud-pro.md).
//
//   GET  /api/cloud-move/estimate   any server: what a move of this workspace carries
//   GET  /api/cloud-move            Cloud home: contents, free space, upload, job, previous Cloud
//   POST /api/cloud-move/upload     start or continue an upload {sha256, bytes, files}
//   PUT  /api/cloud-move/upload/<sha256>?offset=n   one part
//   POST /api/cloud-move/preview    {sha256, password}: check it is a valid backup and stage it
//   POST /api/cloud-move/restore    {id}: back up a Cloud that has work, restore, restart
//   POST /api/cloud-move/undo       restore the previous Cloud, restart
//
// Preview, restore and undo can take minutes on a large workspace, longer
// than a proxy keeps a quiet request open, so each starts one job (202) and
// the app follows it in GET /api/cloud-move.
//
// Every Cloud route needs a paired session with admin scope: the person's
// own app, never the machine's loopback (a bot's shell there) and never a
// client-scope device. Nothing here logs a body, a password or a file name.
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  beginUpload, CLOUD_MOVE_MAX_BYTES, CLOUD_MOVE_MAX_PART_BYTES, CLOUD_MOVE_PART_BYTES, completedUpload, discardUpload, freeVolumeBytes,
  isEmptyWorkspace, markPreviousCloudRestoring, moveSpaceNeeded, previousCloud, savePreviousCloud, stagePreviousCloud, uploadStatus,
  validUploadDeclaration, workspaceContents, workspaceMoveSize, writeUploadPart, type PreviousCloud,
} from "./cloud-move.ts";
import { commitPendingWorkspaceRestore, createWorkspaceBackup, removeWorkspaceBackupJob, stageWorkspaceBackup } from "./workspace-backup.ts";
import type { RequestAuth } from "./request-auth.ts";

export const CLOUD_MOVE_PREFIX = "/api/cloud-move";
const failure = (message: string, status: number) => Object.assign(new Error(message), { status });

type MoveSummary = { appVersion: string; files: number; bytes: number; bots: number; groups: number; threads: number; messages: number };
export type CloudMoveJob =
  | { kind: "preview" | "restore" | "undo"; state: "running" }
  | { kind: "preview"; state: "done"; id: string; summary: MoveSummary }
  | { kind: "restore" | "undo"; state: "done"; id: string; previous?: PreviousCloud | null }
  | { kind: "preview" | "restore" | "undo"; state: "failed"; error: string };

export function createCloudMoveRoutes(options: {
  dataDir: string;
  appVersion: string;
  /** Only an OMB Cloud home receives a move. */
  cloudHome: boolean;
  readBody: (req: IncomingMessage, limit?: number) => Promise<unknown>;
  /** The workspace-backup maintenance gate (quiet bots, writers flushed). */
  exclusive: <T>(work: () => Promise<T>, keepLocked?: boolean) => Promise<T>;
  /** The request's session is still live and still admin. */
  authorized: (req: IncomingMessage, auth: RequestAuth) => boolean;
  status: () => { busy: boolean; pendingRestore: boolean };
  /** What this boot's restore did, for the app waiting on the restart. */
  restored: { id?: string; restored?: boolean; rolledBack?: boolean };
  /** Stop so the launcher starts this server again; startup installs the restore. */
  restart: () => void;
  freeBytes?: (path: string) => number;
  restartDelayMs?: number;
  gateRetryMs?: number;
}) {
  const freeBytes = options.freeBytes ?? freeVolumeBytes;
  // Staged here by a preview; restore accepts nothing else.
  const staged = new Set<string>();
  let job: CloudMoveJob | null = null;
  let writing = false;
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const check = (req: IncomingMessage, auth: RequestAuth) => {
    if (!options.authorized(req, auth)) throw failure("Your session changed. Start the move again.", 403);
  };
  const ready = () => {
    if (job?.state === "running" || writing) throw failure("Another move step is running on your Cloud. Wait for it to finish.", 409);
    const status = options.status();
    if (status.pendingRestore) throw failure("Your Cloud is restarting to finish a restore. Try again in a minute.", 409);
    if (status.busy) throw failure("Your Cloud is busy with a backup. Try again when it finishes.", 409);
  };
  function start(kind: CloudMoveJob["kind"], work: () => Promise<CloudMoveJob>, after?: (result: CloudMoveJob) => void) {
    const current: CloudMoveJob = { kind, state: "running" };
    job = current;
    void work().then((result) => {
      if (job !== current) return;
      job = result;
      after?.(result);
    }, (error: unknown) => {
      if (job === current) job = { kind, state: "failed", error: error instanceof Error ? error.message : "The move could not finish." };
    });
  }
  // A person's own page can hold the workspace gate for a moment (an ordinary
  // request in flight); try the gate a few times before giving up.
  const quietly = async <T>(work: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try { return await options.exclusive(work, true); } catch (error) {
        if (attempt >= 4 || (error as { status?: number }).status !== 409) throw error;
        await new Promise((resolve) => setTimeout(resolve, options.gateRetryMs ?? 2_000));
      }
    }
  };
  // The answer that the restore is ready goes out first; then the launcher
  // starts the server again, and startup installs the restore before anything else loads.
  const restartSoon = () => { setTimeout(() => options.restart(), options.restartDelayMs ?? 1_500).unref?.(); };

  return async (req: IncomingMessage, res: ServerResponse, path: string, auth: RequestAuth): Promise<boolean> => {
    if (path !== CLOUD_MOVE_PREFIX && !path.startsWith(`${CLOUD_MOVE_PREFIX}/`)) return false;
    const method = req.method ?? "GET";
    try {
      if (!auth.scopes.includes("admin")) throw failure("Only the owner can move a workspace.", 403);
      if (method === "GET" && path === `${CLOUD_MOVE_PREFIX}/estimate`) {
        json(res, 200, { ...workspaceContents(options.dataDir), ...workspaceMoveSize(options.dataDir), maxBytes: CLOUD_MOVE_MAX_BYTES });
        return true;
      }
      if (!options.cloudHome) throw failure("Only an OMB Cloud home receives a moved workspace.", 404);
      if (auth.kind !== "session") throw failure("Move to Cloud needs the owner's signed-in app.", 403);
      check(req, auth);
      if (method === "GET" && path === CLOUD_MOVE_PREFIX) {
        const contents = workspaceContents(options.dataDir);
        json(res, 200, {
          contents, empty: isEmptyWorkspace(contents), freeBytes: freeBytes(options.dataDir), maxBytes: CLOUD_MOVE_MAX_BYTES,
          partBytes: CLOUD_MOVE_PART_BYTES, upload: uploadStatus(options.dataDir), previous: previousCloud(options.dataDir), job,
          ...options.status(),
          lastRestoreId: options.restored.restored ? options.restored.id ?? null : null,
          rolledBackId: options.restored.rolledBack ? options.restored.id ?? null : null,
        });
        return true;
      }
      if (method === "POST" && path === `${CLOUD_MOVE_PREFIX}/upload`) {
        const declared = validUploadDeclaration(z.object({ sha256: z.unknown(), bytes: z.unknown(), files: z.unknown().optional() }).parse(await options.readBody(req, 4096)));
        ready();
        const resumed = uploadStatus(options.dataDir);
        const already = resumed?.sha256 === declared.sha256 ? resumed.received : 0;
        const replacing = !isEmptyWorkspace(workspaceContents(options.dataDir));
        const needed = moveSpaceNeeded(declared.bytes, replacing ? workspaceMoveSize(options.dataDir).bytes : 0, replacing) - already;
        const free = freeBytes(options.dataDir);
        if (free < needed) {
          json(res, 507, { error: "Your Cloud does not have enough free space for this move.", freeBytes: free, neededBytes: needed });
          return true;
        }
        check(req, auth);
        job = null;
        json(res, 200, { ...beginUpload(options.dataDir, declared), partBytes: CLOUD_MOVE_PART_BYTES });
        return true;
      }
      const part = /^\/api\/cloud-move\/upload\/([a-f0-9]{64})$/.exec(path);
      if (method === "PUT" && part) {
        const offset = Number(new URL(req.url ?? "/", "http://cloud-move.invalid").searchParams.get("offset"));
        const length = Number(req.headers["content-length"]);
        if (!Number.isSafeInteger(length) || length <= 0 || length > CLOUD_MOVE_MAX_PART_BYTES) throw failure("Send each part with its length, at most 64 MB.", 411);
        ready();
        writing = true;
        let received: number;
        try { received = await writeUploadPart(options.dataDir, part[1], offset, length, req.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>); }
        finally { writing = false; }
        json(res, 200, { received });
        return true;
      }
      if (method === "POST" && path === `${CLOUD_MOVE_PREFIX}/preview`) {
        const body = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), password: z.string().min(12).max(1024) }).parse(await options.readBody(req, 8192));
        ready();
        start("preview", async () => {
          const file = await completedUpload(options.dataDir, body.sha256);
          let result;
          try {
            result = await stageWorkspaceBackup(options.dataDir, file, { password: body.password, currentAppVersion: options.appVersion });
          } finally { discardUpload(options.dataDir); }
          try { check(req, auth); } catch (error) { removeWorkspaceBackupJob(options.dataDir, result.id); throw error; }
          staged.add(result.id);
          const { summary } = result;
          return { kind: "preview", state: "done", id: result.id, summary: {
            appVersion: summary.appVersion, files: summary.files, bytes: summary.bytes, bots: summary.bots,
            groups: summary.groups, threads: summary.threads, messages: summary.messages,
          } };
        });
        json(res, 202, { job });
        return true;
      }
      if (method === "POST" && path === `${CLOUD_MOVE_PREFIX}/restore`) {
        const body = z.object({ id: z.string().uuid() }).parse(await options.readBody(req, 4096));
        ready();
        if (!staged.has(body.id)) throw failure("This move is no longer ready on your Cloud. Start it again.", 404);
        start("restore", () => quietly(async () => {
          check(req, auth);
          // Anything the Cloud already has is backed up first so it can be
          // put back; the restore also keeps its usual safety copy.
          const replacing = !isEmptyWorkspace(workspaceContents(options.dataDir));
          const previous = replacing ? await savePreviousCloud(options.dataDir, (password) =>
            createWorkspaceBackup(options.dataDir, { password, appVersion: options.appVersion })) : null;
          const committed = commitPendingWorkspaceRestore(options.dataDir, body.id);
          staged.delete(body.id);
          return { kind: "restore", state: "done", id: committed.id, previous } as CloudMoveJob;
        }), restartSoon);
        json(res, 202, { job });
        return true;
      }
      if (method === "POST" && path === `${CLOUD_MOVE_PREFIX}/undo`) {
        await options.readBody(req, 4096);
        ready();
        start("undo", async () => {
          const prepared = await stagePreviousCloud(options.dataDir, options.appVersion);
          try {
            return await quietly(async () => {
              check(req, auth);
              const committed = commitPendingWorkspaceRestore(options.dataDir, prepared.id);
              markPreviousCloudRestoring(options.dataDir, committed.id);
              return { kind: "undo", state: "done", id: committed.id } as CloudMoveJob;
            });
          } catch (error) {
            try { removeWorkspaceBackupJob(options.dataDir, prepared.id); } catch { /* kept for recovery */ }
            throw error;
          }
        }, restartSoon);
        json(res, 202, { job });
        return true;
      }
      json(res, 404, { error: "Unknown move operation." });
    } catch (error) {
      if (res.headersSent) { res.destroy(); return true; }
      const status = error instanceof z.ZodError ? 400 : (error as { status?: number }).status ?? 400;
      const received = (error as { received?: unknown }).received;
      json(res, status, {
        error: error instanceof z.ZodError ? "Invalid move request." : error instanceof Error ? error.message : "The move failed.",
        ...(Number.isSafeInteger(received) ? { received } : {}),
      });
    }
    return true;
  };
}
