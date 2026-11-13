import { personMentionExcerpt } from "../shared/person-mention.js";
import { conversationLanguage, serverLine } from "./server-lines.js";
export function summarize(text, max = 140) {
    const line = text.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
    return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}
export function buildSpendNotification(bot, threadId, text) {
    return { kind: "spend", botId: bot.id, botName: bot.name, threadId, title: text.title, body: summarize(text.body, 200) };
}
/** Something SpokyBot did on its own about `bot` that the person hears once, in one plain line. */
export function buildNoticeNotification(bot, threadId, text) {
    return { kind: "notice", botId: bot.id, botName: bot.name, threadId, title: bot.name, body: summarize(text, 240) };
}
const TITLE = {
    approval: "server.notify.approval",
    question: "server.notify.question",
    "routine-failed": "server.notify.routineFailed",
    "routine-deferred": "server.notify.routineDeferred",
    "turn-failed": "server.notify.turnFailed",
    incident: "server.notify.incident",
    "delegation-settled": "server.notify.delegationSettled",
    mention: "server.notify.mention",
    wait: "server.notify.wait",
};
export function buildNotification(kind, bot, threadId, detail, extra) {
    if (bot.notifications === false)
        return null;
    const body = summarize(detail);
    const language = conversationLanguage(threadId);
    const who = extra?.group ? serverLine(language, "server.notify.inRoom", { bot: bot.name, room: extra.group.name }) : bot.name;
    const title = kind === "sign-in"
        ? extra?.site ? serverLine(language, "server.notify.signIn", { who, site: extra.site }) : serverLine(language, "server.notify.signInWebsite", { who })
        : serverLine(language, TITLE[kind] ?? "server.notify.done", { who });
    if ((kind === "done" || kind === "mention") && !body)
        return null;
    const notification = { kind, botId: bot.id, botName: bot.name, threadId, title, body };
    if (extra?.avatarUrl)
        notification.avatarUrl = extra.avatarUrl;
    if (extra?.group)
        notification.groupId = extra.group.id;
    return notification;
}
export function buildMentionNotification(source, bot, room, turn) {
    if (room.dm)
        return null;
    const texts = turn.turnId
        ? source.activePath(turn.threadId).filter((m) => m.role === "bot" && m.kind === "text" && m.turnId === turn.turnId && m.from?.botId === bot.id).map((m) => m.text ?? "")
        : [turn.reply];
    const botNames = room.memberIds.flatMap((id) => {
        const member = source.bot(id);
        return member && !member.hidden ? [member.name] : [];
    });
    for (const text of texts) {
        const excerpt = personMentionExcerpt(text, { profileName: turn.profileName, botNames });
        if (excerpt)
            return buildNotification("mention", { ...bot, threadId: turn.threadId }, turn.threadId, excerpt, { avatarUrl: bot.avatarUrl, group: room });
    }
    return null;
}
