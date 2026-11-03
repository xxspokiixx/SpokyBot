// GET /api/cloud-send/manifest: everything of the person's this server holds that a move carries, by id with a
// fingerprint per kind, on this computer and on their Cloud alike, so the desktop can check that a move carried it all.
// Read only, never a secret: credentials are named here and checked by fingerprint (cloud-send-verify.ts).
import { attachmentNames } from "./cloud-chat-merge.js";
import { listBotFiles } from "./cloud-send-files.js";
import { chatHeads, conversationSettings } from "./cloud-send-chats.js";
import { automationSwitches, routineRunIds } from "./cloud-send-kinds.js";
import { journalIds, memoryFiles, memoryLines, teamsHere } from "./cloud-send-memory.js";
import { factIdentity } from "./memory-entries.js";
import { hashMemoryText } from "./memory-store.js";
import { learnedState } from "./profile-learned.js";
function memoryOf(botId) {
    return memoryFiles(botId).map((file) => ({ bot: botId, path: file.path, hash: hashMemoryText(file.text), lines: memoryLines(file.text) }));
}
export async function cloudSendManifest(sources) {
    const summary = sources.summary();
    const { store } = sources;
    const sent = [...new Set(summary.items.filter((item) => item.kind === "bot" && item.id).map((item) => item.id))];
    const only = sources.bot;
    const rooms = only === undefined ? store.groups.filter((room) => !room.dm) : [];
    const counts = sources.heads();
    const conversations = chatHeads(only === undefined ? store.bots : store.bots.filter((bot) => bot.id === only), rooms).map((head) => ({
        threadId: head.threadId, ...(head.bot ? { bot: head.bot } : { room: head.room }), rows: counts.get(head.threadId)?.rows ?? 0, newest: head.lastId,
        settings: conversationSettings(store, head),
    }));
    const attachments = new Set();
    for (const { threadId } of conversations)
        for (const row of store.messagesFor(threadId))
            for (const name of attachmentNames(row, sources.dataDir))
                attachments.add(name);
    if (only !== undefined) {
        return { v: 1, appVersion: summary.appVersion, items: summary.items, memory: [], journal: [], learned: [], forgotten: [], teams: [], rooms: [], connections: [],
            conversations, attachments: [...attachments].sort(), files: await listBotFiles(sources.dataDir, sent),
            automations: sources.kinds ? automationSwitches(sources.kinds, only) : [], runs: sources.kinds ? routineRunIds(sources.kinds, only) : [] };
    }
    return {
        v: 1,
        appVersion: summary.appVersion,
        items: summary.items,
        memory: sent.flatMap(memoryOf),
        journal: sent.map((bot) => ({ bot, ids: journalIds(bot) })).filter((entry) => entry.ids.length),
        learned: [...new Set(learnedState().learned.map((fact) => factIdentity(fact.text)).filter(Boolean))].sort(),
        forgotten: [...new Set(learnedState().removed)].sort(),
        teams: sources.teamMemory ? teamsHere(sources.teamMemory).map((team) => ({ section: team.section, context: team.context === null ? null : memoryLines(team.context),
            memory: team.memory.map((entry) => entry.key ?? `${entry.kind}:${entry.name.toLowerCase()}`).sort() })) : [],
        rooms: rooms.map((room) => ({ id: room.id, name: room.name, members: [...room.memberIds].sort(),
            threads: room.tasks?.length ? room.tasks.map((task) => task.threadId) : [room.threadId] })),
        connections: (await sources.connections()).map((item) => item.id).sort(),
        conversations,
        attachments: [...attachments].sort(),
        files: await listBotFiles(sources.dataDir, sent),
        automations: sources.kinds ? automationSwitches(sources.kinds) : [],
        runs: sources.kinds ? routineRunIds(sources.kinds) : [],
    };
}
