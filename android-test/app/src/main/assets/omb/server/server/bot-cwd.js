import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { isOwnThreadFolder } from "../shared/thread-folder.js";
export function validateBotCwd(input) {
    if (input === null)
        return { ok: true, cwd: null };
    if (typeof input !== "string")
        return { ok: false, error: "working folder must be a path" };
    const trimmed = input.trim();
    if (!trimmed)
        return { ok: true, cwd: null };
    const expanded = trimmed === "~" || trimmed.startsWith("~/") ? homedir() + trimmed.slice(1) : trimmed;
    if (!isAbsolute(expanded))
        return { ok: false, error: "working folder must be an absolute path" };
    const cwd = resolve(expanded);
    let stat;
    try {
        stat = statSync(cwd);
    }
    catch {
        return { ok: false, error: `that folder doesn't exist: ${cwd}` };
    }
    if (!stat.isDirectory())
        return { ok: false, error: `that path is not a folder: ${cwd}` };
    return { ok: true, cwd };
}
/** The working folder a thread moves to on this turn: its bot's, while the thread is still in its own folder. Never for a
 * conversation that keeps a private folder (a Cloud guest's), nor for an engine that works in no folder. */
export function folderToFollow(bot, threadId, threadCwd, opts) {
    if (!bot.cwd || !opts.worksInFolders || opts.keepsPrivateFolder)
        return undefined;
    return isOwnThreadFolder(threadCwd, bot.id, threadId) ? bot.cwd : undefined;
}
/** A conversation's folder a teammate may be sent to: one that still exists, outside SpokyBot's own data (a bot's private workspace). */
export function sharedProjectFolder(cwd, dataDir) {
    const checked = cwd ? validateBotCwd(cwd) : undefined;
    if (!checked?.ok || !checked.cwd)
        return undefined;
    const inside = relative(resolve(dataDir), checked.cwd);
    return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside)) ? undefined : checked.cwd;
}
/** coordinate_bots' in_my_folder: the sender's project folder for the teammate threads it opens outside a room, or why an explicit true cannot be honoured. Omitted means on whenever there is a folder to share. */
export function inMyFolderCwd(wanted, outsideRoom, senderCwd, dataDir) {
    if (wanted === false)
        return {};
    if (!outsideRoom)
        return wanted ? { error: "in_my_folder does not apply in a room: the room's folder governs there. Leave it out." } : {};
    const cwd = sharedProjectFolder(senderCwd, dataDir);
    if (cwd)
        return { cwd };
    return wanted ? { error: "This conversation has no project folder to share (it works in its own private folder), so in_my_folder cannot be used. Leave it out; do not retry it." } : {};
}
