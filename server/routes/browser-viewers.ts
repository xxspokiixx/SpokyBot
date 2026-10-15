// People's views of a bot's browser. v1 (GET …/browser/live as server-sent events, POST …/browser/action) is what the
// phone apps speak, and its contract is frozen. v2 (GET …/browser/stream, a WebSocket) is the desktop panel's and the
// web UI's, on the new engine only: a page's file picker is answered by POST …/browser/upload and a finished download
// is fetched from GET …/browser/download/:id. Never mix login frames into the general events feed, which every device
// reads.
import { createReadStream } from "node:fs";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";

import { storeUploads } from "../browser-upload.ts";
import type { BrowserLive } from "../browser-live.ts";
import type { LiveRouter } from "../browser/engines.ts";
import { messageFileDisposition } from "../message-file.ts";
import { isSameOrigin, type RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";
import type { Upgrades } from "./upgrades.ts";

const LIVE = /^\/api\/bots\/([\w-]+)\/browser\/(live|action)$/;
const STREAM = /^\/api\/bots\/([\w-]+)\/browser\/stream$/;
const UPLOAD = /^\/api\/bots\/([\w-]+)\/browser\/upload$/;
const DOWNLOAD = /^\/api\/bots\/([\w-]+)\/browser\/download\/([\w-]{1,64})$/;
const CHOOSER = /^[\w-]{1,64}$/;
const UPLOAD_MAX_FILES = 20;
const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

type Spec = Parameters<BrowserLive["open"]>[0]["spec"];
type Failure = { status: number; error: string };

export interface BrowserViewerRouteDeps {
  upgrades: Upgrades;
  viewers: Pick<LiveRouter, "open" | "action" | "stream" | "answerFileChooser" | "download">;
  /** A bot with its browser on, and the session and spec that browser runs as. */
  browser(botId: string): Promise<{ botId: string; session: string; spec: Spec } | Failure>;
  /** Hosted workspaces check the member's sign-in again before a view opens. */
  authorize(req: IncomingMessage, auth: RequestAuth): Promise<Failure | null>;
  /** Whether a view opened for `session` still shows the bot's current browser to a live sign-in. */
  current(botId: string, session: string, auth: RequestAuth): boolean;
  /** Why a person may not restart this browser now, or null. */
  restartRefusal(session: string): string | null;
  dataDir: string;
}

const ownerOf = (auth: RequestAuth) => (auth.kind === "session" ? auth.session.id : "local-owner");

class UploadError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The multipart `file` parts of an upload, read whole: at most 20 files and 100 MiB in all. */
async function uploadedFiles(req: IncomingMessage): Promise<Array<{ name: string; bytes: Uint8Array }>> {
  const type = String(req.headers["content-type"] ?? "");
  if (!/^multipart\/form-data;/i.test(type)) throw new UploadError(415, "Send the files as multipart form data.");
  if (Number(req.headers["content-length"]) > UPLOAD_MAX_BYTES) throw new UploadError(413, "Those files are larger than 100 MB in all.");
  let bytes = 0;
  const limited = req.pipe(new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      done(bytes > UPLOAD_MAX_BYTES ? new UploadError(413, "Those files are larger than 100 MB in all.") : null, chunk);
    },
  }));
  req.once("error", (error) => limited.destroy(error));
  let form: FormData;
  try {
    form = await new Request("http://upload.invalid/", {
      method: "POST", headers: { "content-type": type }, body: Readable.toWeb(limited) as ReadableStream, duplex: "half",
    } as RequestInit).formData();
  } catch (error) {
    throw error instanceof UploadError ? error : bytes > UPLOAD_MAX_BYTES ? new UploadError(413, "Those files are larger than 100 MB in all.") : new UploadError(400, "The upload was not valid form data.");
  }
  const files = form.getAll("file").filter((entry): entry is File => typeof entry !== "string");
  if (files.length > UPLOAD_MAX_FILES) throw new UploadError(413, `A page takes at most ${UPLOAD_MAX_FILES} files at once.`);
  return Promise.all(files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
}

export function createBrowserViewerRoutes(deps: BrowserViewerRouteDeps): RouteHandler {
  deps.upgrades.route((path) => STREAM.test(path));
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const live = LIVE.exec(path);
    const stream = live ? null : STREAM.exec(path);
    const upload = live || stream ? null : UPLOAD.exec(path);
    const download = live || stream || upload ? null : DOWNLOAD.exec(path);
    const botId = (live ?? stream ?? upload ?? download)?.[1];
    if (!botId) return PASS;
    res.setHeader("cache-control", "no-store");
    const browser = await deps.browser(botId);
    if ("error" in browser) return json(res, browser.status, { error: browser.error });
    // Discovery may have awaited while the portal closed this owner's streams: never open a late replacement on the earlier authorization.
    const failure = await deps.authorize(req, auth);
    if (failure) return json(res, failure.status, { error: failure.error });
    const owner = ownerOf(auth);
    const isCurrent = () => deps.current(browser.botId, browser.session, auth);

    if (live) {
      if (method === "GET" && live[2] === "live") {
        req.socket.setTimeout(0);
        return await deps.viewers.open({ botId: browser.botId, session: browser.session, spec: browser.spec, owner, isCurrent, res });
      }
      if (method === "POST" && live[2] === "action") {
        const body = await readBody(req, 32_768);
        if (!isCurrent()) return json(res, 409, { error: "This browser session changed. Reopen the browser panel." });
        if (typeof body?.viewerId !== "string") return json(res, 400, { error: "A live browser connection is required." });
        const refused = body.type === "restart" && deps.restartRefusal(browser.session);
        if (refused) return json(res, 409, { error: refused });
        return json(res, 200, await deps.viewers.action({ viewerId: body.viewerId, botId: browser.botId, owner, body }));
      }
      return json(res, 405, { error: "method not allowed" });
    }

    if (stream) {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      const pending = deps.upgrades.pending(req);
      if (!pending) return json(res, 426, { error: "WebSocket upgrade required" });
      if (!isSameOrigin(req)) return json(res, 403, { error: "forbidden: cross-origin request" });
      if (pending.socket.destroyed) return;
      if (!isCurrent()) return json(res, 409, { error: "This browser session changed. Reopen the browser panel." });
      // From here the stream reads the socket itself.
      pending.release();
      const opened = deps.viewers.stream({
        session: browser.session, spec: browser.spec, botId: browser.botId, owner,
        canOperate: url.searchParams.get("interactive") !== "false",
        params: url.searchParams, req, socket: pending.socket, head: pending.head,
        isCurrent, restartRefusal: () => deps.restartRefusal(browser.session),
      });
      if (!opened) return json(res, 409, { error: "This browser shows in the live view only." });
      res.detachSocket(pending.socket);
      return;
    }

    if (upload) {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const chooser = url.searchParams.get("chooser") ?? "";
      if (!CHOOSER.test(chooser)) return json(res, 400, { error: "Name the page's file picker." });
      let files: Array<{ name: string; bytes: Uint8Array }>;
      try { files = await uploadedFiles(req); }
      catch (error) {
        if (!(error instanceof UploadError)) throw error;
        // The rest of a refused body is never read.
        res.setHeader("connection", "close");
        return json(res, error.status, { error: error.message });
      }
      const paths = storeUploads(files, join(deps.dataDir, "browser-uploads"));
      const answered = await deps.viewers.answerFileChooser(browser, owner, chooser, paths).catch(() => false);
      if (!answered) return json(res, 409, { error: "The page's file picker is no longer open." });
      res.writeHead(204).end();
      return;
    }

    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    const file = deps.viewers.download(browser, download![2]!);
    if (!file?.path) return json(res, 404, { error: "That download is not available." });
    const saved = file.path;
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": String(file.receivedBytes),
      "content-disposition": messageFileDisposition(file.fileName),
      "x-content-type-options": "nosniff",
    });
    await new Promise<void>((resolve) => {
      const reading = createReadStream(saved);
      reading.once("error", () => { res.destroy(); resolve(); });
      res.once("close", () => { reading.destroy(); resolve(); });
      reading.pipe(res);
    });
  };
}
