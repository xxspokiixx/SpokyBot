import { createHash, randomUUID } from "node:crypto";
import { createReadStream, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync, } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { join, extname } from "node:path";
import { publishCandidate } from "../electron/atomic-publish.mjs";
import { DATA_DIR } from "./config.js";
export const ATTACHMENTS_DIR = join(DATA_DIR, "attachments");
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** Below Cloudflare's transport ceiling; a local inbox, not unbounded storage. */
export const FILE_MAX_BYTES = 25 * 1024 * 1024;
export const DEFAULT_ATTACHMENTS_MAX_BYTES = 512 * 1024 * 1024;
/** A person's own Cloud is the only home of everything their computers held, on a volume a move grows to fit. */
export const CLOUD_HOME_ATTACHMENTS_MAX_BYTES = 8 * 1024 * 1024 * 1024;
/** A team server can raise the ceiling with OMB_ATTACHMENTS_MAX_BYTES; a missing or invalid value keeps 512 MB, or 8 GB on a Cloud home. */
export function attachmentsMaxBytes(env = process.env) {
    const raw = env.OMB_ATTACHMENTS_MAX_BYTES?.trim();
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isSafeInteger(parsed) && parsed > 0)
        return parsed;
    return env.OMB_CLOUD_ROLE === "home" || env.OMB_CLOUD_ROLE === "team" ? CLOUD_HOME_ATTACHMENTS_MAX_BYTES : DEFAULT_ATTACHMENTS_MAX_BYTES;
}
/** Never evict: prompts refer to attachment paths, so at this ceiling a new upload gets an explicit 507. */
export const ATTACHMENTS_MAX_BYTES = attachmentsMaxBytes();
function formatStoreLimit(bytes) {
    const mb = Math.round(bytes / (1024 * 1024));
    return mb >= 1 ? `${mb} MB` : `${bytes} bytes`;
}
/** Cleanup removes only our stale partial files, never a committed attachment a transcript may reference. */
export const ATTACHMENT_PARTIAL_MAX_AGE_MS = 60 * 60 * 1000;
const PARTIAL_NAME = /^\.openmaus-upload-[0-9a-f-]+-[0-9a-f-]+\.partial$/i;
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const activePartials = new Set();
const uploadLocks = new Map();
let reservedAttachmentBytes = 0;
const STREAM_RESERVATION_INCREMENT_BYTES = 1024 * 1024;
/** Cached quota usage (null: rescan needed); single-process state, since one server owns a data dir. */
let committedAttachmentBytes = null;
// An async link may finish after a scan already counted its file; the version keeps it from counting twice.
let attachmentAccountingVersion = 0;
function invalidateAttachmentAccounting() {
    committedAttachmentBytes = null;
    attachmentAccountingVersion += 1;
}
/** No sniffing: a lying mime only changes the filename. */
const IMAGE_MIMES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
};
/** No archives, binaries, HTML, SVG or scripts. The claimed mime picks the extension; an attacker's filename never does. */
const FILE_MIMES = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "audio/opus": ".opus",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/aac": ".aac",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/wave": ".wav",
    "audio/flac": ".flac",
    "audio/x-flac": ".flac",
    "audio/webm": ".webm",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "text/csv": ".csv",
    "text/tab-separated-values": ".tsv",
    "application/json": ".json",
    "application/pdf": ".pdf",
    "application/rtf": ".rtf",
    "text/rtf": ".rtf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/vnd.oasis.opendocument.text": ".odt",
    "application/vnd.oasis.opendocument.spreadsheet": ".ods",
    "application/vnd.oasis.opendocument.presentation": ".odp",
};
export function extensionForMime(mime) {
    if (!mime)
        return null;
    return IMAGE_MIMES[mime.split(";")[0].trim().toLowerCase()] ?? null;
}
export function ensureAttachmentsDir() {
    mkdirSync(ATTACHMENTS_DIR, { recursive: true, mode: 0o700 });
}
function unlinkPartialSync(path) {
    try {
        unlinkSync(path);
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    }
}
async function unlinkPartial(path) {
    try {
        await unlink(path);
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    }
}
export function validateAttachmentUploadId(value) {
    if (value === undefined)
        return undefined;
    const normalized = value.trim().toLowerCase();
    if (!UPLOAD_ID.test(normalized)) {
        throw statusError(400, "uploadId must be a UUID");
    }
    return normalized;
}
function scanAttachmentUsageAndCleanup(now = Date.now()) {
    ensureAttachmentsDir();
    let bytes = 0;
    let removed = 0;
    for (const entry of readdirSync(ATTACHMENTS_DIR, { withFileTypes: true })) {
        if (!entry.isFile())
            continue;
        const path = join(ATTACHMENTS_DIR, entry.name);
        // A live partial is counted by its reservation; a crashed process's orphan counts until this scan removes it.
        if (PARTIAL_NAME.test(entry.name) && activePartials.has(path))
            continue;
        try {
            const stat = statSync(path);
            if (PARTIAL_NAME.test(entry.name) && now - stat.mtimeMs >= ATTACHMENT_PARTIAL_MAX_AGE_MS) {
                unlinkSync(path);
                removed += 1;
            }
            else {
                bytes += stat.size;
            }
        }
        catch {
        }
    }
    return { bytes, removed };
}
/** Reservations must use this rather than trust a cold cache. */
function committedBytes() {
    if (committedAttachmentBytes === null) {
        committedAttachmentBytes = scanAttachmentUsageAndCleanup().bytes;
        attachmentAccountingVersion += 1;
    }
    return committedAttachmentBytes;
}
/** Never for idempotent retries, which reuse bytes already counted; after an accounting change the next reservation rescans. */
function addCommittedBytes(delta, version = attachmentAccountingVersion) {
    if (version !== attachmentAccountingVersion || committedAttachmentBytes === null) {
        invalidateAttachmentAccounting();
        return;
    }
    committedAttachmentBytes += delta;
}
export function cleanupStaleAttachmentPartials(now = Date.now()) {
    const { bytes, removed } = scanAttachmentUsageAndCleanup(now);
    committedAttachmentBytes = bytes;
    attachmentAccountingVersion += 1;
    return removed;
}
/** Every removal of a file saveImage/saveFile created must come through here, or the cache overcounts and rejects uploads. */
export function deleteAttachment(path) {
    try {
        const size = committedAttachmentBytes !== null ? statSync(path).size : 0;
        unlinkSync(path);
        if (committedAttachmentBytes !== null) {
            committedAttachmentBytes = Math.max(0, committedAttachmentBytes - size);
        }
    }
    catch {
    }
}
export function __resetAttachmentAccountingForTests() {
    invalidateAttachmentAccounting();
}
/** Holding the upload id's lock, any inactive partial with its prefix is a crashed attempt and can go now. */
function cleanupAttachmentPartialsForUpload(uploadId) {
    ensureAttachmentsDir();
    const prefix = `.openmaus-upload-${uploadId}-`;
    for (const entry of readdirSync(ATTACHMENTS_DIR, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.startsWith(prefix) || !PARTIAL_NAME.test(entry.name))
            continue;
        const path = join(ATTACHMENTS_DIR, entry.name);
        if (activePartials.has(path))
            continue;
        try {
            const size = committedAttachmentBytes !== null ? statSync(path).size : 0;
            unlinkSync(path);
            if (committedAttachmentBytes !== null) {
                committedAttachmentBytes = Math.max(0, committedAttachmentBytes - size);
            }
        }
        catch {
        }
    }
}
class AttachmentReservation {
    held = 0;
    released = false;
    reserve(bytes) {
        if (this.released || bytes <= 0)
            return;
        this.reserveAtLeast(bytes, bytes);
    }
    reserveAtLeast(required, preferred) {
        const used = committedBytes();
        const available = ATTACHMENTS_MAX_BYTES - used - reservedAttachmentBytes;
        if (available < required) {
            throw statusError(507, `attachments storage is full (${formatStoreLimit(ATTACHMENTS_MAX_BYTES)} limit)`);
        }
        const granted = Math.min(preferred, available);
        reservedAttachmentBytes += granted;
        this.held += granted;
    }
    ensure(bytes) {
        if (bytes <= this.held)
            return;
        const required = bytes - this.held;
        const remainingPerFileCapacity = FILE_MAX_BYTES - this.held;
        const preferred = Math.min(Math.max(required, STREAM_RESERVATION_INCREMENT_BYTES), remainingPerFileCapacity);
        this.reserveAtLeast(required, preferred);
    }
    release() {
        if (this.released)
            return;
        this.released = true;
        reservedAttachmentBytes -= this.held;
        this.held = 0;
    }
}
async function withUploadLock(uploadId, operation) {
    if (!uploadId)
        return operation();
    const previous = uploadLocks.get(uploadId) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
        release = resolve;
    });
    uploadLocks.set(uploadId, current);
    await previous;
    try {
        return await operation();
    }
    finally {
        release();
        if (uploadLocks.get(uploadId) === current)
            uploadLocks.delete(uploadId);
    }
}
/** saveFile/saveImage only ever write `${uuid}${extension}` with one of these extensions. */
const KNOWN_ATTACHMENT_EXTENSIONS = Array.from(new Set([...Object.values(IMAGE_MIMES), ...Object.values(FILE_MIMES)]));
function statSizeIfFile(path) {
    try {
        const stat = statSync(path);
        return stat.isFile() ? stat.size : null;
    }
    catch {
        return null;
    }
}
function committedPathForUpload(uploadId, extension) {
    ensureAttachmentsDir();
    const exactPath = join(ATTACHMENTS_DIR, `${uploadId}${extension}`);
    if (statSizeIfFile(exactPath) !== null)
        return exactPath;
    for (const other of KNOWN_ATTACHMENT_EXTENSIONS) {
        if (other === extension)
            continue;
        if (statSizeIfFile(join(ATTACHMENTS_DIR, `${uploadId}${other}`)) !== null) {
            throw statusError(409, "uploadId was already used for another content type");
        }
    }
    return null;
}
async function digestFile(path) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path))
        hash.update(chunk);
    return hash.digest("hex");
}
function statusError(status, message) {
    return Object.assign(new Error(message), { status });
}
function normalizedMime(mime) {
    const value = mime?.split(";")[0]?.trim().toLowerCase();
    return value || null;
}
export function extensionForFileMime(mime) {
    const value = normalizedMime(mime);
    return value ? FILE_MIMES[value] ?? null : null;
}
/** Separators and encoded separators are rejected, not massaged, so traversal attempts stay visible as bad requests. */
export function sanitizeSharedFileName(name, mime) {
    const extension = extensionForFileMime(mime);
    if (!extension)
        throw statusError(400, "content-type must be a supported document or audio type");
    const normalized = name.normalize("NFKC").trim();
    if (!normalized)
        throw statusError(400, "name is required");
    if (normalized.length > 512)
        throw statusError(400, "name is too long");
    if (/[\\/]/.test(normalized) || /%(?:00|2f|5c)/i.test(normalized)) {
        throw statusError(400, "name must be a filename, not a path");
    }
    const dot = normalized.lastIndexOf(".");
    const withoutExtension = dot > 0 ? normalized.slice(0, dot) : normalized;
    const safeCharacters = Array.from(withoutExtension, (character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127 || "<>:\"|?*".includes(character) ? "_" : character;
    }).join("");
    const stem = safeCharacters
        .replace(/^\.+/, "")
        .replace(/[.\s]+$/, "")
        .replace(/\s+/g, " ")
        .trim();
    const boundedStem = Array.from(stem).slice(0, 180).join("");
    if (!boundedStem)
        throw statusError(400, "name must contain visible characters");
    return `${boundedStem}${extension}`;
}
/** Never buffers the request; a failed, empty or oversized upload leaves no partial file. */
export async function saveFile(chunks, originalName, mime, options = {}) {
    const normalized = normalizedMime(mime);
    if (!normalized || !extensionForFileMime(normalized)) {
        throw statusError(400, "content-type must be a supported document or audio type");
    }
    const name = sanitizeSharedFileName(originalName, normalized);
    const extension = extensionForFileMime(normalized);
    const uploadId = validateAttachmentUploadId(options.uploadId);
    const expectedBytes = options.expectedBytes;
    if (expectedBytes !== undefined && (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0)) {
        throw statusError(400, "content-length must be a non-negative integer");
    }
    if (expectedBytes !== undefined && expectedBytes > FILE_MAX_BYTES) {
        throw statusError(413, `file exceeds ${FILE_MAX_BYTES} bytes`);
    }
    return withUploadLock(uploadId, async () => {
        ensureAttachmentsDir();
        if (uploadId)
            cleanupAttachmentPartialsForUpload(uploadId);
        const existing = uploadId ? committedPathForUpload(uploadId, extension) : null;
        if (existing) {
            const incomingHash = createHash("sha256");
            let bytes = 0;
            for await (const value of chunks) {
                const chunk = Buffer.isBuffer(value)
                    ? value
                    : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
                if (chunk.byteLength === 0)
                    continue;
                if (bytes + chunk.byteLength > FILE_MAX_BYTES) {
                    throw statusError(413, `file exceeds ${FILE_MAX_BYTES} bytes`);
                }
                incomingHash.update(chunk);
                bytes += chunk.byteLength;
            }
            if (bytes === 0)
                throw statusError(400, "empty file");
            if (statSync(existing).size !== bytes || await digestFile(existing) !== incomingHash.digest("hex")) {
                throw statusError(409, "uploadId was already used for different file bytes");
            }
            return { path: existing, name, mime: normalized, bytes };
        }
        const id = uploadId ?? randomUUID();
        const path = join(ATTACHMENTS_DIR, `${id}${extension}`);
        const partialPath = join(ATTACHMENTS_DIR, `.openmaus-upload-${id}-${randomUUID()}.partial`);
        const reservation = new AttachmentReservation();
        if (expectedBytes)
            reservation.reserve(expectedBytes);
        activePartials.add(partialPath);
        let file;
        let bytes = 0;
        let closed = false;
        let partialCleanupFailed = false;
        try {
            file = await open(partialPath, "wx", 0o600);
            for await (const value of chunks) {
                const chunk = Buffer.isBuffer(value)
                    ? value
                    : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
                if (chunk.byteLength === 0)
                    continue;
                if (bytes + chunk.byteLength > FILE_MAX_BYTES) {
                    throw statusError(413, `file exceeds ${FILE_MAX_BYTES} bytes`);
                }
                reservation.ensure(bytes + chunk.byteLength);
                let offset = 0;
                while (offset < chunk.byteLength) {
                    const result = await file.write(chunk, offset, chunk.byteLength - offset, null);
                    if (result.bytesWritten === 0)
                        throw new Error("file write made no progress");
                    offset += result.bytesWritten;
                }
                bytes += chunk.byteLength;
            }
            if (bytes === 0)
                throw statusError(400, "empty file");
            await file.close();
            closed = true;
            const accountingVersion = attachmentAccountingVersion;
            if (publishCandidate(partialPath, path)) {
                addCommittedBytes(bytes, accountingVersion);
            }
            else if (statSync(path).size !== bytes || await digestFile(path) !== await digestFile(partialPath)) {
                throw statusError(409, "uploadId was already used for different file bytes");
            }
            await unlinkPartial(partialPath);
            return { path, name, mime: normalized, bytes };
        }
        catch (error) {
            if (file && !closed)
                await file.close().catch(() => undefined);
            await unlinkPartial(partialPath).catch(() => { partialCleanupFailed = true; });
            throw error;
        }
        finally {
            activePartials.delete(partialPath);
            // Rescan after releasing a leftover partial, so a retry cannot subtract bytes never counted.
            if (partialCleanupFailed)
                invalidateAttachmentAccounting();
            reservation.release();
        }
    });
}
/** An attachment another computer's chats name, kept under that name: counted against the store's limit like any
 * upload (507 when it is full), written under a partial name cleanup knows, never over a file already here, and never
 * leaving a partial file behind. `stored`: false when the same file was here already. */
export async function saveNamedAttachment(name, chunks, expectedBytes) {
    if (expectedBytes !== undefined && expectedBytes > FILE_MAX_BYTES)
        throw statusError(413, `attachments are limited to ${FILE_MAX_BYTES} bytes`);
    ensureAttachmentsDir();
    const path = join(ATTACHMENTS_DIR, name);
    const partialPath = join(ATTACHMENTS_DIR, `.openmaus-upload-${randomUUID()}-${randomUUID()}.partial`);
    const reservation = new AttachmentReservation();
    activePartials.add(partialPath);
    let file;
    let partialCleanupFailed = false;
    try {
        if (expectedBytes)
            reservation.reserve(expectedBytes);
        file = await open(partialPath, "wx", 0o600);
        let bytes = 0;
        for await (const value of chunks) {
            const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
            if (bytes + chunk.byteLength > FILE_MAX_BYTES)
                throw statusError(413, `attachments are limited to ${FILE_MAX_BYTES} bytes`);
            reservation.ensure(bytes + chunk.byteLength);
            await file.write(chunk);
            bytes += chunk.byteLength;
        }
        await file.close();
        file = undefined;
        const accountingVersion = attachmentAccountingVersion;
        if (!publishCandidate(partialPath, path))
            return { stored: false };
        addCommittedBytes(bytes, accountingVersion);
        return { stored: true };
    }
    finally {
        if (file)
            await file.close().catch(() => undefined);
        await unlinkPartial(partialPath).catch(() => { partialCleanupFailed = true; });
        activePartials.delete(partialPath);
        if (partialCleanupFailed)
            invalidateAttachmentAccounting();
        reservation.release();
    }
}
/** The UUID filename is never attacker-controlled and never collides. */
export function saveImage(bytes, mime, requestedUploadId) {
    const ext = extensionForMime(mime);
    if (!ext)
        throw Object.assign(new Error("unsupported image type"), { status: 400 });
    if (bytes.byteLength === 0)
        throw Object.assign(new Error("empty image"), { status: 400 });
    if (bytes.byteLength > IMAGE_MAX_BYTES) {
        throw Object.assign(new Error(`image exceeds ${IMAGE_MAX_BYTES} bytes`), { status: 413 });
    }
    const uploadId = validateAttachmentUploadId(requestedUploadId);
    ensureAttachmentsDir();
    const existing = uploadId ? committedPathForUpload(uploadId, ext) : null;
    if (existing) {
        const saved = readFileSync(existing);
        if (!saved.equals(bytes)) {
            throw statusError(409, "uploadId was already used for different image bytes");
        }
        return { path: existing, mime: mime.split(";")[0].trim().toLowerCase(), bytes: bytes.byteLength };
    }
    const reservation = new AttachmentReservation();
    reservation.reserve(bytes.byteLength);
    const id = uploadId ?? randomUUID();
    const name = `${id}${ext}`;
    const path = join(ATTACHMENTS_DIR, name);
    const partialPath = join(ATTACHMENTS_DIR, `.openmaus-upload-${id}-${randomUUID()}.partial`);
    activePartials.add(partialPath);
    let partialCleanupFailed = false;
    try {
        writeFileSync(partialPath, bytes, { mode: 0o600, flag: "wx" });
        if (publishCandidate(partialPath, path)) {
            addCommittedBytes(bytes.byteLength);
        }
        else {
            const saved = readFileSync(path);
            if (!saved.equals(bytes)) {
                throw statusError(409, "uploadId was already used for different image bytes");
            }
        }
        unlinkPartialSync(partialPath);
        return { path, mime: mime.split(";")[0].trim().toLowerCase(), bytes: bytes.byteLength };
    }
    catch (error) {
        try {
            unlinkPartialSync(partialPath);
        }
        catch {
            partialCleanupFailed = true;
        }
        throw error;
    }
    finally {
        activePartials.delete(partialPath);
        if (partialCleanupFailed)
            invalidateAttachmentAccounting();
        reservation.release();
    }
}
/** Cloud voices answer in MP3; the built-in Mac voices (`say`) and Chatterbox answer in WAV. */
const AUDIO_MIMES = {
    "audio/mpeg": { mime: "audio/mpeg", ext: ".mp3" },
    "audio/wav": { mime: "audio/wav", ext: ".wav" },
    "audio/x-wav": { mime: "audio/wav", ext: ".wav" },
    "audio/wave": { mime: "audio/wav", ext: ".wav" },
};
export function saveAudio(bytes, mime) {
    const format = AUDIO_MIMES[mime.split(";")[0].trim().toLowerCase()];
    if (!format) {
        throw Object.assign(new Error("unsupported audio type"), { status: 400 });
    }
    if (bytes.byteLength === 0)
        throw Object.assign(new Error("empty audio"), { status: 400 });
    if (bytes.byteLength > FILE_MAX_BYTES) {
        throw Object.assign(new Error(`audio exceeds ${FILE_MAX_BYTES} bytes`), { status: 413 });
    }
    ensureAttachmentsDir();
    const reservation = new AttachmentReservation();
    reservation.reserve(bytes.byteLength);
    const id = randomUUID();
    const name = `${id}${format.ext}`;
    const path = join(ATTACHMENTS_DIR, name);
    const partialPath = join(ATTACHMENTS_DIR, `.openmaus-upload-${id}-${randomUUID()}.partial`);
    activePartials.add(partialPath);
    let partialCleanupFailed = false;
    try {
        writeFileSync(partialPath, bytes, { mode: 0o600, flag: "wx" });
        if (publishCandidate(partialPath, path)) {
            addCommittedBytes(bytes.byteLength);
        }
        else {
            const saved = readFileSync(path);
            if (!saved.equals(bytes)) {
                throw Object.assign(new Error("audio destination already exists with different bytes"), { status: 409 });
            }
        }
        unlinkPartialSync(partialPath);
        return { path, mime: format.mime, bytes: bytes.byteLength };
    }
    catch (error) {
        try {
            unlinkPartialSync(partialPath);
        }
        catch {
            partialCleanupFailed = true;
        }
        throw error;
    }
    finally {
        activePartials.delete(partialPath);
        if (partialCleanupFailed)
            invalidateAttachmentAccounting();
        reservation.release();
    }
}
/** Takes the per-id lock, so an image and a document with one caller-supplied UUID cannot commit with different extensions. */
export async function saveImageUpload(bytes, mime, requestedUploadId) {
    const uploadId = validateAttachmentUploadId(requestedUploadId);
    return withUploadLock(uploadId, async () => {
        if (uploadId)
            cleanupAttachmentPartialsForUpload(uploadId);
        return saveImage(bytes, mime, uploadId);
    });
}
export function attachmentExists(name) {
    if (!/^[A-Za-z0-9-]+\.(png|jpg|gif|webp)$/.test(name))
        return false;
    try {
        return statSync(join(ATTACHMENTS_DIR, name)).isFile();
    }
    catch {
        return false;
    }
}
/** Only a bare filename inside ATTACHMENTS_DIR resolves: the route must never become a file server for the data dir. */
export function readAttachment(name) {
    if (!/^[A-Za-z0-9-]+\.(png|jpg|jpeg|gif|webp|mp3|wav)$/.test(name))
        return null;
    const path = join(ATTACHMENTS_DIR, name);
    if (extname(path) === ".jpeg")
        return null;
    try {
        return { bytes: readFileSync(path), mime: mimeForExt(extname(path)) };
    }
    catch {
        return null;
    }
}
function mimeForExt(ext) {
    switch (ext) {
        case ".png":
            return "image/png";
        case ".jpg":
            return "image/jpeg";
        case ".gif":
            return "image/gif";
        case ".webp":
            return "image/webp";
        case ".mp3":
            return "audio/mpeg";
        case ".wav":
            return "audio/wav";
        default:
            return "application/octet-stream";
    }
}
/** Honours only `a-b`, `a-` and `-n`; anything else gets the whole file, always a correct answer to a GET. */
export function parseAudioRange(header, size) {
    const raw = header?.trim();
    if (!raw)
        return { kind: "none" };
    const m = raw.match(/^bytes=(\d*)-(\d*)$/);
    if (!m)
        return { kind: "none" };
    const [, rawStart, rawEnd] = m;
    if (rawStart === "") {
        // `bytes=-` is malformed, not a suffix range; `bytes=-0` is unsatisfiable per RFC 9110.
        if (rawEnd === "")
            return { kind: "none" };
        const suffix = Number(rawEnd);
        if (!suffix)
            return { kind: "unsatisfiable" };
        if (size === 0)
            return { kind: "unsatisfiable" };
        return { kind: "range", start: Math.max(0, size - suffix), end: size - 1 };
    }
    const start = Number(rawStart);
    if (start >= size)
        return { kind: "unsatisfiable" };
    if (rawEnd === "")
        return { kind: "range", start, end: size - 1 };
    const end = Number(rawEnd);
    if (end < start)
        return { kind: "none" };
    return { kind: "range", start, end: Math.min(end, size - 1) };
}
