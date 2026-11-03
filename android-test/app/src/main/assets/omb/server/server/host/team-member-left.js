// When a person leaves a Team Cloud (an admin removes them, or they leave), what was theirs alone goes with them: their
// private chats with every bot (messages, notifications, the files only those chats used), their memory layers, their
// "About you", their own connections, their own browsers, and every session and phone of theirs. Nothing of it is handed
// to an admin. The Admin tells this machine with a signed request (`POST /api/cloud/team/member-left`, cloud-signed.ts).
//
// Each conversation keeps its starter (thread-starters.json, a hash): what other records still name it (a decision's
// row, a usage trace) stays someone else's, so no admin ever reads it there either.
import { readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { memberAudience } from "../audience.js";
import { forgetBotMemoryJournal, journalFile } from "../memory-journal.js";
import { deleteBotMemoryFiles } from "../message-db.js";
import { personKey } from "../person-key.js";
const ATTACHMENT = /\/api\/attachments\/([A-Za-z0-9][\w.-]{0,200})/g;
const PERSON = /^p_[\w-]{22}$/;
export function createTeamMemberLeft(deps) {
    const workspaces = join(deps.dataDir, "workspaces");
    return async (email) => {
        const person = personKey({ id: "", email });
        if (!PERSON.test(person))
            throw new Error("not a person key");
        // First, so nothing of theirs is opened, written or streamed while it goes.
        const sessions = deps.revokeSessions(email);
        const mine = new Set(deps.openedBy(person).filter((threadId) => deps.privateTo(threadId) === person));
        let chats = 0;
        const files = new Set();
        for (const bot of deps.store.bots) {
            const threads = (bot.tasks ?? []).map((task) => task.threadId).filter((threadId) => mine.has(threadId));
            if (!threads.length)
                continue;
            for (const threadId of threads) {
                if (deps.busy(bot.id, threadId))
                    await deps.stop(bot.id, threadId).catch(() => { });
                for (const match of JSON.stringify(deps.store.messagesFor(threadId)).matchAll(ATTACHMENT))
                    files.add(match[1]);
            }
            chats += deps.deleteTasks(bot.id, threads)?.deleted.length ?? 0;
        }
        // A file only their chats used goes too; one a bot's picture or another conversation uses stays.
        let removed = 0;
        for (const name of files) {
            const url = `/api/attachments/${name}`;
            if (name.includes("..") || deps.threadsReferencing(url).length || deps.store.bots.some((bot) => bot.avatarUrl === url))
                continue;
            deps.deleteAttachment(basename(name));
            removed++;
        }
        let layers = 0;
        let entries = [];
        try {
            entries = readdirSync(workspaces);
        }
        catch { }
        for (const layer of entries.filter((entry) => entry.endsWith(`--member-${person}`))) {
            rmSync(join(workspaces, layer), { recursive: true, force: true });
            rmSync(journalFile(layer), { force: true });
            deleteBotMemoryFiles(layer);
            forgetBotMemoryJournal(layer);
            layers++;
        }
        rmSync(join(deps.dataDir, "people", person), { recursive: true, force: true });
        deps.forgetConnections(person);
        const browsers = await deps.eraseBrowsers(memberAudience(person)).catch(() => false);
        return { chats, layers, sessions, files: removed, browsers };
    };
}
