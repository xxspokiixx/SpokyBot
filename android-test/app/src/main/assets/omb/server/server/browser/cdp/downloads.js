import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { DriverError } from "./errors.js";
export const DOWNLOAD_LIMITS = { maxBytes: 1024 ** 3, perOwner: 20 };
const UNSAFE_NAME = /[\p{Cc}<>:"/\\|?*]/gu;
export function safeFileName(suggested) {
    const base = suggested.split(/[\\/]/).pop() ?? "";
    const cleaned = base.replace(UNSAFE_NAME, "_").replace(/^[.\s]+|[.\s]+$/g, "");
    let name = cleaned || "download";
    while (Buffer.byteLength(name, "utf8") > 255)
        name = name.slice(0, -1);
    return name;
}
/** Downloads land as `<dir>/<id>/<name>`: Chrome writes `<dir>/<guid>` (allowAndName) and the finished file moves. */
export class Downloads {
    dir;
    #session;
    #ownerOf;
    #limits;
    #byGuid = new Map();
    #listeners = new Set();
    constructor(session, dir, { ownerOf, limits = DOWNLOAD_LIMITS }) {
        this.#session = session;
        this.dir = dir;
        this.#ownerOf = ownerOf;
        this.#limits = limits;
        session.on("Browser.downloadWillBegin", (params) => this.#begin(params));
        session.on("Browser.downloadProgress", (params) => this.#progress(params));
    }
    async enable() {
        mkdirSync(this.dir, { recursive: true, mode: 0o700 });
        await this.#session.send("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: this.dir, eventsEnabled: true });
    }
    list(owner) {
        return [...this.#byGuid.values()].filter((download) => owner === undefined || download.owner === owner);
    }
    onChange(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }
    /** The next download `match` accepts to finish, completed or canceled. */
    finished(match, timeoutMs = 30_000) {
        const done = [...this.#byGuid.values()].find((download) => download.state !== "inProgress" && match(download));
        if (done)
            return Promise.resolve(done);
        return new Promise((resolve, reject) => {
            const off = this.onChange((download) => {
                if (download.state === "inProgress" || !match(download))
                    return;
                off();
                clearTimeout(timer);
                resolve(download);
            });
            const timer = setTimeout(() => {
                off();
                reject(new DriverError("timeout", `No download finished within ${timeoutMs} ms.`));
            }, timeoutMs);
        });
    }
    #emit(download) {
        for (const listener of this.#listeners) {
            try {
                listener(download);
            }
            catch { }
        }
    }
    #begin(params) {
        const guid = String(params.guid);
        const download = {
            id: randomUUID(),
            guid,
            url: String(params.url ?? "").slice(0, 2_048),
            fileName: safeFileName(String(params.suggestedFilename ?? "")),
            owner: this.#ownerOf(String(params.frameId ?? "")),
            state: "inProgress",
            receivedBytes: 0,
            totalBytes: 0,
            path: null,
            startedAt: Date.now(),
            finishedAt: null,
        };
        this.#byGuid.set(guid, download);
        this.#emit(download);
    }
    #progress(params) {
        const download = this.#byGuid.get(String(params.guid));
        if (!download || download.state !== "inProgress")
            return;
        download.receivedBytes = Number(params.receivedBytes) || 0;
        download.totalBytes = Number(params.totalBytes) || 0;
        if (params.state === "inProgress") {
            if (Math.max(download.receivedBytes, download.totalBytes) > this.#limits.maxBytes) {
                download.canceledBecause = `larger than ${this.#limits.maxBytes} bytes`;
                void this.#session.send("Browser.cancelDownload", { guid: download.guid }).catch(() => { });
            }
            return;
        }
        download.finishedAt = Date.now();
        const written = typeof params.filePath === "string" ? params.filePath : join(this.dir, download.guid);
        if (params.state === "completed" && !download.canceledBecause)
            this.#keep(download, written);
        else {
            download.state = "canceled";
            rmSync(written, { force: true });
        }
        this.#emit(download);
    }
    #keep(download, written) {
        try {
            const size = statSync(written).size;
            if (size > this.#limits.maxBytes)
                throw new Error(`larger than ${this.#limits.maxBytes} bytes`);
            const folder = join(this.dir, download.id);
            mkdirSync(folder, { recursive: true, mode: 0o700 });
            const path = join(folder, download.fileName);
            renameSync(written, path);
            download.path = path;
            download.receivedBytes = size;
            download.state = "completed";
        }
        catch (error) {
            download.state = "canceled";
            download.canceledBecause = error instanceof Error ? error.message : String(error);
            rmSync(written, { force: true });
            return;
        }
        const kept = this.list(download.owner ?? undefined).filter((entry) => entry.state === "completed" && entry.path);
        for (const evicted of kept.slice(0, Math.max(0, kept.length - this.#limits.perOwner))) {
            rmSync(join(this.dir, evicted.id), { recursive: true, force: true });
            this.#byGuid.delete(evicted.guid);
        }
    }
}
