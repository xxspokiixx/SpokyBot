// Served without auth at /.well-known/openmausbot/environment, so a saved connection can check it still reaches the same server.
import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { SERVER_ROOT } from "./proxy-paths.js";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function hasCode(error, code) {
    return error instanceof Error && "code" in error && error.code === code;
}
function readEnvironmentId(file) {
    let contents;
    try {
        contents = readFileSync(file, "utf8");
    }
    catch (error) {
        if (hasCode(error, "ENOENT"))
            return undefined;
        throw new Error(`Cannot read the existing environment identity at ${file}; refusing to replace it.`, {
            cause: error,
        });
    }
    const id = contents.trim();
    if (!UUID_PATTERN.test(id)) {
        throw new Error(`The existing environment identity at ${file} is not a valid UUID; refusing to replace it.`);
    }
    return id;
}
/** Read or create the id. Written once, never rotated by the server itself. */
export function loadEnvironmentId(dataDir) {
    const file = join(dataDir, "environment-id");
    const existing = readEnvironmentId(file);
    if (existing)
        return existing;
    const directory = dirname(file);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const temporaryFile = join(directory, `.environment-id.${process.pid}.${randomUUID()}.tmp`);
    let descriptor;
    try {
        descriptor = openSync(temporaryFile, "wx", 0o600);
        writeFileSync(descriptor, id + "\n", "utf8");
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = undefined;
        try {
            // A hard link publishes atomically without replacing; on Android / some filesystems
            // hard links are not supported, so fall back to rename which is also atomic on POSIX.
            // If rename also fails (e.g., cross-device), fall back to copy+unlink.
            try {
                linkSync(temporaryFile, file);
            }
            catch {
                try {
                    renameSync(temporaryFile, file);
                }
                catch {
                    // Last resort: copy then unlink
                    const content = readFileSync(temporaryFile, "utf8");
                    writeFileSync(file, content, { mode: 0o600 });
                    unlinkSync(temporaryFile);
                }
            }
            return id;
        }
        catch (error) {
            if (!hasCode(error, "EEXIST"))
                throw error;
            const winner = readEnvironmentId(file);
            if (winner)
                return winner;
            throw new Error(`The environment identity at ${file} disappeared while it was being created.`);
        }
    }
    finally {
        if (descriptor !== undefined)
            closeSync(descriptor);
        try {
            unlinkSync(temporaryFile);
        }
        catch {
        }
    }
}
let stamp;
/** This server's release and, on a Cloud, its image: what it runs changes with either, the engines' CLIs included. */
export function buildStamp() {
    stamp ??= [serverVersion(), process.env.OMB_CLOUD_IMAGE?.trim()].filter(Boolean).join(" ");
    return stamp;
}
/** The desktop's own version, else the bundle's package.json (scripts/bundle-server.mjs), else the checkout's. */
export function serverVersion(root = SERVER_ROOT) {
    const fromEnv = process.env.OMB_APP_VERSION?.trim();
    if (fromEnv)
        return fromEnv;
    for (const file of [join(root, "package.json"), join(root, "..", "package.json")]) {
        try {
            const version = Reflect.get(Object(JSON.parse(readFileSync(file, "utf8"))), "version");
            if (typeof version === "string" && version)
                return version;
        }
        catch {
        }
    }
    return "unknown";
}
export function environmentDescriptor(input) {
    return {
        environmentId: input.environmentId,
        label: input.label?.trim() || process.env.OMB_ENVIRONMENT_LABEL?.trim() || hostname(),
        platform: process.platform,
        version: serverVersion(),
        capabilities: {
            remoteSessions: true,
            // Never advertise a protocol this server would refuse.
            // lendingDetails: a lent computer may say its platform, and this server remembers what was lent to it.
            ...(input.sharedComputers === true ? { sharedComputers: true, lendingDetails: true, commandTimeouts: true, longCommands: true, fileEdits: true } : {}),
            ...(input.sharedComputers === true && input.cloudHome === true ? { deviceLink: true } : {}),
            ...(input.sharedComputers === true && input.cloudHome === true && input.cloudTeam !== true ? { myChromeLink: true, computerAsks: true } : {}),
            ...(input.cloudHome === true ? { cloudHome: true, move: 1 } : {}),
            ...(input.ownHome === true && input.cloudHome !== true ? { move: 1 } : {}),
            ...(input.cloudHome === true && input.cloudTeam === true ? { cloudTeam: true } : {}),
            selfUpdate: input.desktopManaged ? "desktop-managed" : "operator",
            emailSignIn: input.emailSignIn === true,
            jobs: true,
        },
    };
}
