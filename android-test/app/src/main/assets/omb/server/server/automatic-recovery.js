import { supportsWorkspaceFiles } from "./workspace.js";
/** The backups a bot's turn tries, in order, when its AI provably never started it: the bot's own list, which needs no
 * switch, or else the installation's one backup while Automatic recovery is on. */
export function startupBackups(bot, recovery) {
    if (bot.fallback?.length)
        return bot.fallback;
    return recovery?.enabled && recovery.backup ? [recovery.backup] : [];
}
/** An automatic switch must not strand the task without its tools or move its filesystem to another machine. */
export function recoveryCapabilityError(from, to) {
    if (supportsWorkspaceFiles(from.driverKind) !== supportsWorkspaceFiles(to.driverKind)) {
        return "The backup cannot use the same workspace.";
    }
    const tools = ["agentsMcp", "computerMcp", "composioMcp", "dataMcp", "highlevelMcp", "deviceMcp",
        "phoneMcp", "browserMcp", "localComputerMcp", "customMcp", "images"];
    if (tools.some(key => from.capabilities[key] === true && to.capabilities[key] !== true)) {
        return "The backup does not support all of this AI's tools and attachments.";
    }
}
