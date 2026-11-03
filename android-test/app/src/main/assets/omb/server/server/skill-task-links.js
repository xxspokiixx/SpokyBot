import { syncImportedSkillLinks } from "./imported-skills.js";
import { syncSkillLinks } from "./skills.js";
import { ensureTaskWorkspace } from "./workspace.js";
export function syncTaskSkillLinks(botId, threadId, options = {}) {
    syncSkillLinks(botId, { ...options, task: { threadId, folder: ensureTaskWorkspace(botId, threadId) } });
}
/** The turn's task folder, with the bot's enabled skills and this turn's skills from this computer (`imported`)
 * linked in. A failed link only loses native discovery; the prompt index still lists them. */
export function ensureTaskWorkspaceWithSkills(botId, threadId, imported = []) {
    const folder = ensureTaskWorkspace(botId, threadId);
    const linkImported = () => {
        try {
            syncImportedSkillLinks(botId, folder, imported);
        }
        catch (error) {
            console.warn(`[skills] linking this computer's skills into the task folder failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    // Before the bot's own, so a name it now holds itself is free; after, so a name it gave up is linked this turn.
    linkImported();
    try {
        syncTaskSkillLinks(botId, threadId);
    }
    catch (error) {
        console.warn(`[skills] linking skills into the task folder failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    linkImported();
    return folder;
}
