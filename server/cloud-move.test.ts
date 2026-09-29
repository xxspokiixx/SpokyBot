// Move to Cloud's Cloud side in isolation: the resumable upload slot, what
// counts as an empty Cloud, the space check, the routes' owner-only gate, and
// the previous Cloud. The whole move over two real servers is
// cloud-move.e2e.test.ts.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  beginUpload, CLOUD_MOVE_MAX_BYTES, CLOUD_MOVE_SPACE_MARGIN, completedUpload, isEmptyWorkspace, markPreviousCloudRestoring, moveSpaceNeeded,
  previousCloud, savePreviousCloud, stagePreviousCloud, uploadStatus, validUploadDeclaration, workspaceContents, workspaceMoveSize, writeUploadPart,
} from "./cloud-move.ts";
import { createCloudMoveRoutes } from "./cloud-move-http.ts";
import { readBody } from "./harness/http.ts";
import { resolveRequestAuth, type RequestAuth } from "./request-auth.ts";
import { SessionRegistry } from "./sessions.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { createWorkspaceBackupSnapshot } from "./workspace-backup.ts";

let dataDir: string;
beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), "omb-cloud-move-")); });
afterEach(async () => { await removeTempDir(dataDir); });

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function* body(...parts: Buffer[]) { for (const part of parts) yield part; }
function messages(rows: Array<{ thread: string; role: string }>) {
  const db = new DatabaseSync(join(dataDir, "messages.db"));
  db.exec("CREATE TABLE messages(thread_id TEXT, id TEXT, at INTEGER, role TEXT, kind TEXT, text TEXT, json TEXT, PRIMARY KEY(thread_id, id)); CREATE TABLE thread_state(thread_id TEXT PRIMARY KEY, active_leaf_id TEXT);");
  const insert = db.prepare("INSERT INTO messages VALUES (?, ?, 1, ?, 'text', 'hi', ?)");
  for (const row of rows) insert.run(row.thread, randomUUID(), row.role, JSON.stringify({ role: row.role, text: "hi" }));
  db.close();
}

it("resumes an upload by its SHA-256, accepts a repeated part without writing it twice, and answers where it stands", async () => {
  const file = randomBytes(3000), declared = { sha256: sha(file), bytes: file.length };
  expect(beginUpload(dataDir, declared)).toMatchObject({ received: 0 });
  expect(await writeUploadPart(dataDir, declared.sha256, 0, 1000, body(file.subarray(0, 600), file.subarray(600, 1000)))).toBe(1000);
  // A retry of a part the Cloud already stored (its answer was lost) is a no-op.
  expect(await writeUploadPart(dataDir, declared.sha256, 0, 1000, body(file.subarray(0, 1000)))).toBe(1000);
  await expect(writeUploadPart(dataDir, declared.sha256, 2000, 1000, body(file.subarray(2000)))).rejects.toMatchObject({ status: 409, received: 1000 });
  // The same file again continues; nothing already received is lost.
  expect(beginUpload(dataDir, declared)).toMatchObject({ received: 1000 });
  expect(await writeUploadPart(dataDir, declared.sha256, 1000, 2000, body(file.subarray(1000)))).toBe(3000);
  expect(readFileSync(await completedUpload(dataDir, declared.sha256)).equals(file)).toBe(true);
  // A different file replaces the slot.
  const other = randomBytes(100);
  expect(beginUpload(dataDir, { sha256: sha(other), bytes: 100 })).toMatchObject({ received: 0 });
  expect(uploadStatus(dataDir)).toEqual({ sha256: sha(other), bytes: 100, received: 0 });
});

it("never lets an upload grow past what it declared, and cuts a failed part back off", async () => {
  const file = randomBytes(1000), declared = { sha256: sha(file), bytes: file.length };
  beginUpload(dataDir, declared);
  await expect(writeUploadPart(dataDir, declared.sha256, 0, 1001, body(file, Buffer.alloc(1)))).rejects.toMatchObject({ status: 413 });
  // A part that brings more than its declared length is refused and removed.
  await expect(writeUploadPart(dataDir, declared.sha256, 0, 500, body(file))).rejects.toMatchObject({ status: 413 });
  expect(uploadStatus(dataDir)?.received).toBe(0);
  // A part that ends early is incomplete, and removed too.
  await expect(writeUploadPart(dataDir, declared.sha256, 0, 500, body(file.subarray(0, 200)))).rejects.toMatchObject({ status: 400 });
  expect(uploadStatus(dataDir)?.received).toBe(0);
  await expect(writeUploadPart(dataDir, sha(randomBytes(8)), 0, 10, body(file.subarray(0, 10)))).rejects.toMatchObject({ status: 404 });
});

it("discards an upload whose bytes do not match its SHA-256", async () => {
  const file = randomBytes(64), declared = { sha256: sha(randomBytes(64)), bytes: file.length };
  beginUpload(dataDir, declared);
  await writeUploadPart(dataDir, declared.sha256, 0, 64, body(file));
  await expect(completedUpload(dataDir, declared.sha256)).rejects.toMatchObject({ status: 400 });
  expect(uploadStatus(dataDir)).toBeNull();
});

it("bounds a declared upload by size and file count", () => {
  expect(() => validUploadDeclaration({ sha256: "a".repeat(64), bytes: CLOUD_MOVE_MAX_BYTES + 1 })).toThrow(expect.objectContaining({ status: 413 }));
  expect(() => validUploadDeclaration({ sha256: "a".repeat(64), bytes: 4096, files: 100_001 })).toThrow(expect.objectContaining({ status: 413 }));
  expect(() => validUploadDeclaration({ sha256: "not-a-hash", bytes: 4096 })).toThrow(expect.objectContaining({ status: 400 }));
  expect(() => validUploadDeclaration({ sha256: "a".repeat(64), bytes: 10 })).toThrow(expect.objectContaining({ status: 400 }));
  expect(validUploadDeclaration({ sha256: "a".repeat(64), bytes: CLOUD_MOVE_MAX_BYTES, files: 100_000 })).toEqual({ sha256: "a".repeat(64), bytes: CLOUD_MOVE_MAX_BYTES });
});

it("calls a Cloud empty only with its starter bot at most, no rooms, and nobody's chat", () => {
  expect(isEmptyWorkspace(workspaceContents(dataDir))).toBe(true);
  writeFileSync(join(dataDir, "bots.json"), JSON.stringify([{ id: "starter" }]));
  messages([{ thread: "t1", role: "bot" }]);
  expect(workspaceContents(dataDir)).toEqual({ bots: 1, rooms: 0, chats: 0 });
  expect(isEmptyWorkspace(workspaceContents(dataDir))).toBe(true);
  writeFileSync(join(dataDir, "groups.json"), JSON.stringify([{ id: "room" }]));
  expect(isEmptyWorkspace(workspaceContents(dataDir))).toBe(false);
  writeFileSync(join(dataDir, "groups.json"), "[]");
  writeFileSync(join(dataDir, "bots.json"), JSON.stringify([{ id: "starter" }, { id: "second" }]));
  expect(isEmptyWorkspace(workspaceContents(dataDir))).toBe(false);
});

it("counts a conversation someone took part in as a chat", () => {
  writeFileSync(join(dataDir, "bots.json"), JSON.stringify([{ id: "starter" }]));
  messages([{ thread: "t1", role: "bot" }, { thread: "t1", role: "user" }, { thread: "t2", role: "user" }, { thread: "t3", role: "bot" }]);
  expect(workspaceContents(dataDir)).toEqual({ bots: 1, rooms: 0, chats: 2 });
  expect(isEmptyWorkspace(workspaceContents(dataDir))).toBe(false);
});

it("sizes a move by the backup's own rules: credentials, sessions and caches are not counted", () => {
  writeFileSync(join(dataDir, "bots.json"), "x".repeat(100));
  mkdirSync(join(dataDir, "attachments"));
  writeFileSync(join(dataDir, "attachments", "a.png"), "x".repeat(1000));
  writeFileSync(join(dataDir, "sessions.json"), "x".repeat(5000));
  writeFileSync(join(dataDir, "workspace-credentials.json"), "x".repeat(5000));
  mkdirSync(join(dataDir, "providers", "claude"), { recursive: true });
  writeFileSync(join(dataDir, "providers", "claude", ".credentials.json"), "x".repeat(5000));
  mkdirSync(join(dataDir, "cache"));
  writeFileSync(join(dataDir, "cache", "big.bin"), "x".repeat(5000));
  expect(workspaceMoveSize(dataDir)).toEqual({ bytes: 1100, files: 2 });
});

it("needs room for the upload three times over, plus a backup of a Cloud it replaces", () => {
  expect(moveSpaceNeeded(1000, 500, false)).toBe(3000 + CLOUD_MOVE_SPACE_MARGIN);
  expect(moveSpaceNeeded(1000, 500, true)).toBe(4000 + CLOUD_MOVE_SPACE_MARGIN);
});

it("keeps the previous Cloud until a restore of it is installed, never showing its password", async () => {
  writeFileSync(join(dataDir, "bots.json"), JSON.stringify([{ id: "one" }, { id: "two" }]));
  writeFileSync(join(dataDir, "config.json"), JSON.stringify({ profile: { name: "Cloud" } }));
  const saved = await savePreviousCloud(dataDir, (password) => createWorkspaceBackupSnapshot(dataDir, { password, appVersion: "0.1.90" }));
  expect(saved).toMatchObject({ bots: 2, rooms: 0, chats: 0 });
  expect(previousCloud(dataDir)).toEqual(saved);
  expect(JSON.stringify(previousCloud(dataDir))).not.toMatch(/password/);
  const staged = await stagePreviousCloud(dataDir, "0.1.90");
  expect(staged.summary.bots).toBe(2);
  markPreviousCloudRestoring(dataDir, staged.id);
  // Not installed yet (or rolled back): still offered.
  expect(previousCloud(dataDir)).toEqual(saved);
  writeFileSync(join(dataDir, ".backups", "last-restore.json"), JSON.stringify({ restored: true, id: staged.id }));
  expect(previousCloud(dataDir)).toBeNull();
  await expect(stagePreviousCloud(dataDir, "0.1.90")).rejects.toMatchObject({ status: 404 });
}, 60_000);

// ── the routes ──────────────────────────────────────────────────────────
let server: Server | undefined;
afterEach(async () => { await new Promise<void>((done) => server ? server.close(() => done()) : done()); server = undefined; });
async function routes(options: { cloudHome?: boolean; freeBytes?: number; exclusive?: <T>(work: () => Promise<T>) => Promise<T> } = {}) {
  const sessions = new SessionRegistry({ file: join(dataDir, "sessions.json") });
  const owner = sessions.issue({ label: "Owner's app", scopes: ["admin", "client"] });
  const phone = sessions.issue({ label: "Phone", scopes: ["client"] });
  let base = "";
  const authenticate = (req: IncomingMessage) => resolveRequestAuth(req, { sessions, cookieName: "fixture", streamPath: "/api/events", url: new URL(req.url!, base) });
  const restarts: number[] = [];
  const handle = createCloudMoveRoutes({
    dataDir, appVersion: "0.1.90", cloudHome: options.cloudHome ?? true, readBody, restored: {},
    exclusive: options.exclusive ?? ((work) => work()), authorized: (req, auth) => authenticate(req).auth?.kind === auth.kind,
    status: () => ({ busy: false, pendingRestore: false }), restart: () => restarts.push(Date.now()),
    freeBytes: () => options.freeBytes ?? 1024 ** 4, gateRetryMs: 0, restartDelayMs: 0,
  });
  server = createServer(async (req, res) => {
    const gate = authenticate(req);
    if (!gate.auth) { res.writeHead(gate.status); res.end(); return; }
    if (!(await handle(req, res, new URL(req.url!, base).pathname, gate.auth as RequestAuth))) { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
  const call = async (method: string, path: string, token?: string, value?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: {
      ...(token ? { authorization: `Bearer ${token}`, "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.9", host: "cloud.example.test" } : {}),
      ...(value === undefined ? {} : { "content-type": "application/json" }) }, body: value === undefined ? undefined : JSON.stringify(value) });
    return { status: response.status, body: await response.json().catch(() => null) as any };
  };
  return { call, owner: owner.token, phone: phone.token, restarts };
}

it("refuses a move that does not fit the Cloud's volume, counting a backup of what it replaces", async () => {
  writeFileSync(join(dataDir, "bots.json"), JSON.stringify([{ id: "a" }, { id: "b" }]));
  mkdirSync(join(dataDir, "attachments"));
  writeFileSync(join(dataDir, "attachments", "big.bin"), Buffer.alloc(1_000_000));
  // The session registry below writes its open marker first; it is not part of a backup.
  new SessionRegistry({ file: join(dataDir, "sessions.json") });
  const bytes = 50_000_000, needed = moveSpaceNeeded(bytes, workspaceMoveSize(dataDir).bytes, true);
  const tight = await routes({ freeBytes: needed - 1 });
  const refused = await tight.call("POST", "/api/cloud-move/upload", tight.owner, { sha256: "a".repeat(64), bytes });
  expect(refused).toEqual({ status: 507, body: { error: expect.stringMatching(/free space/), freeBytes: needed - 1, neededBytes: needed } });
  expect(uploadStatus(dataDir)).toBeNull();
  server!.close(); server = undefined;
  const roomy = await routes({ freeBytes: needed });
  expect((await roomy.call("POST", "/api/cloud-move/upload", roomy.owner, { sha256: "a".repeat(64), bytes })).status).toBe(200);
});

it("answers only the owner's app on a Cloud home: not its loopback, not a client device, not another server", async () => {
  const cloud = await routes();
  expect((await cloud.call("GET", "/api/cloud-move", cloud.owner)).status).toBe(200);
  expect((await cloud.call("GET", "/api/cloud-move")).status).toBe(403);
  expect((await cloud.call("POST", "/api/cloud-move/upload")).status).toBe(403);
  expect((await cloud.call("GET", "/api/cloud-move", cloud.phone)).status).toBe(403);
  expect((await cloud.call("POST", "/api/cloud-move/undo", cloud.phone, {})).status).toBe(403);
  // Every server sizes its own workspace for its desktop; none but a Cloud receives one.
  expect((await cloud.call("GET", "/api/cloud-move/estimate")).status).toBe(200);
  server!.close(); server = undefined;
  const desktop = await routes({ cloudHome: false });
  expect((await desktop.call("GET", "/api/cloud-move", desktop.owner)).status).toBe(404);
  expect((await desktop.call("POST", "/api/cloud-move/upload", desktop.owner, { sha256: "a".repeat(64), bytes: 4096 })).status).toBe(404);
  expect(existsSync(join(dataDir, ".backups", "cloud-move"))).toBe(false);
  expect(desktop.restarts).toEqual([]);
});

it("restores only what its own preview staged", async () => {
  const cloud = await routes();
  const restore = await cloud.call("POST", "/api/cloud-move/restore", cloud.owner, { id: randomUUID() });
  expect(restore.status).toBe(404);
  expect(cloud.restarts).toEqual([]);
  expect(statSync(dataDir).isDirectory()).toBe(true);
});

it("refuses a session without admin scope even if a gate in front let it through", async () => {
  const { Readable } = await import("node:stream");
  const handle = createCloudMoveRoutes({
    dataDir, appVersion: "0.1.90", cloudHome: true, readBody, restored: {}, exclusive: (work) => work(), authorized: () => true,
    status: () => ({ busy: false, pendingRestore: false }), restart: () => { throw new Error("must not restart"); },
  });
  const answer = async (auth: RequestAuth, method: string, path: string) => {
    const req = Object.assign(Readable.from([Buffer.from("{}")]), { method, url: path, headers: { "content-type": "application/json" } }) as unknown as IncomingMessage;
    let status = 0;
    const res = { headersSent: false, setHeader() {}, writeHead(code: number) { status = code; return res; }, end() {}, once() { return res; }, destroy() {} };
    await handle(req, res as never, path, auth);
    return status;
  };
  const session = { id: "s", label: "Phone", scopes: ["client"], createdAt: 0, lastSeenAt: 0, expiresAt: Date.now() + 60_000 };
  const client = { kind: "session", via: "bearer", scopes: ["client"], session } as unknown as RequestAuth;
  for (const [method, path] of [["GET", "/api/cloud-move"], ["POST", "/api/cloud-move/undo"], ["GET", "/api/cloud-move/estimate"]]) {
    expect(await answer(client, method, path)).toBe(403);
  }
  const owner = { ...client, scopes: ["admin", "client"] } as RequestAuth;
  expect(await answer(owner, "GET", "/api/cloud-move")).toBe(200);
});

it("Restore previous Cloud waits out a moment of activity, then commits and restarts", async () => {
  writeFileSync(join(dataDir, "bots.json"), JSON.stringify([{ id: "one" }, { id: "two" }]));
  await savePreviousCloud(dataDir, (password) => createWorkspaceBackupSnapshot(dataDir, { password, appVersion: "0.1.90" }));
  let refusals = 2;
  const cloud = await routes({ exclusive: async (work) => {
    if (refusals-- > 0) throw Object.assign(new Error("Wait for bot turns to finish."), { status: 409 });
    return work();
  } });
  expect((await cloud.call("POST", "/api/cloud-move/undo", cloud.owner, {})).status).toBe(202);
  await expect.poll(async () => (await cloud.call("GET", "/api/cloud-move", cloud.owner)).body.job?.state, { timeout: 30_000 }).toBe("done");
  expect(refusals).toBe(-1);
  await expect.poll(() => cloud.restarts.length).toBe(1);
  expect(existsSync(join(dataDir, ".backups", "pending-restore.json"))).toBe(true);
}, 60_000);
