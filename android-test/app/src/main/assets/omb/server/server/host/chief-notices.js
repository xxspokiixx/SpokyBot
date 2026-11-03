import { failedTurnTool } from "../../shared/failed-turn.js";
import { admit } from "../admission.js";
import { ESCALATIONS_THREAD_TITLE, EscalationLedger, escalationChip, escalationDeliverable, escalationText } from "../escalations.js";
import { chiefForBot, INCIDENTS_THREAD_TITLE, IncidentLedger, incidentChip, incidentContext, incidentText } from "../incidents.js";
import { buildNotification } from "../notify.js";
import { redactSecretsInText } from "../redact.js";
import { queueSteeredMessage } from "../steer-queue.js";
export function createChiefNotices(deps) {
    const { store } = deps;
    const incidentLedger = new IncidentLedger();
    const escalationLedger = new EscalationLedger();
    function incidentRefused(chief, incidentsThreadId, asks, why) {
        const refused = `the incident could not reach ${chief.name} — ${why}`;
        store.appendMessage(incidentsThreadId, { role: "bot", kind: "activity", tool: failedTurnTool(refused) });
        const lines = store.messagesFor(incidentsThreadId);
        for (const ask of asks) {
            if (!ask?.incident || ask.incident.notified)
                continue;
            const bot = store.bot(ask.botId);
            if (!bot)
                continue;
            const { threadId } = ask.incident;
            const chip = lines.findLast(line => line.kind === "activity" && line.tool?.ok === false && line.threadRef?.threadId === threadId)?.tool?.name;
            const group = store.groupByThread(threadId);
            deps.notify(buildNotification("incident", bot, threadId, chip ?? refused, {
                avatarUrl: bot.avatarUrl,
                ...(group ? { group: { id: group.id, name: group.name } } : {}),
            }));
        }
    }
    function deliver(input) {
        const { chief, bot, threadId } = input;
        const task = store.taskByThread(bot.id, threadId);
        const group = store.groupByThread(threadId);
        const tellThePerson = () => {
            if (!input.alreadyNotified) {
                deps.notify(buildNotification("incident", bot, threadId, input.chip, {
                    avatarUrl: bot.avatarUrl,
                    ...(group ? { group: { id: group.id, name: group.name } } : {}),
                }));
            }
            return "person";
        };
        if (!chief || deps.privateThread?.(threadId))
            return tellThePerson();
        const notices = store.tasks(chief.id).find((candidate) => candidate.title === input.title && !candidate.archivedAt)
            ?? store.createTask(chief.id, input.title, false, undefined, { botId: chief.id, name: chief.name, at: Date.now() });
        if (!notices || notices.threadId === threadId)
            return tellThePerson();
        store.appendMessage(notices.threadId, {
            role: "bot",
            kind: "activity",
            tool: { name: input.chip, ok: false },
            threadRef: { botId: bot.id, threadId, title: task?.title ?? (group ? group.name : `${bot.name}'s conversation`) },
        });
        const peerAsk = { botId: bot.id, name: bot.name, unattended: true,
            incident: { threadId, ...(input.alreadyNotified ? { notified: true } : {}) } };
        const decision = admit("incident", {}, {
            threadBusy: deps.threadBusy(chief.id, notices.threadId),
            atCapacity: deps.botAtThreadCapacity(chief.id),
            groupTurn: deps.groupTurnActive(chief.id),
        });
        if (decision.action === "queue") {
            queueSteeredMessage(chief.id, notices.threadId, input.text, { reason: decision.reason, unattended: true, peerAsk });
            return "chief";
        }
        void deps.startTurn(chief.id, input.text, { threadId: notices.threadId, unattended: true, peerAsk }).catch((error) => {
            incidentRefused(chief, notices.threadId, [peerAsk], error instanceof Error ? error.message : String(error));
        });
        return "chief";
    }
    function reportIncident(input) {
        const { bot, threadId } = input;
        if (deps.quietThread?.(bot.id, threadId))
            return;
        const task = store.taskByThread(bot.id, threadId);
        if (deps.assignerOf(threadId))
            return;
        const group = store.groupByThread(threadId);
        const incident = {
            kind: input.kind,
            bot,
            threadId,
            title: task?.title ?? null,
            room: group?.name ?? null,
            detail: redactSecretsInText(input.detail),
            ...incidentContext(deps.store.messagesFor(threadId)),
        };
        const count = incidentLedger.note(threadId);
        if (count.muted)
            return;
        deliver({
            chief: chiefForBot(store.bots, bot), title: INCIDENTS_THREAD_TITLE, bot, threadId,
            chip: incidentChip(incident), text: incidentText(incident, count),
            alreadyNotified: input.kind === "could-not-start" || input.kind === "routine-failed",
        });
    }
    // Advisory: a delivery fault is logged and never reaches the gate, the turn fold or the caller's own outcome.
    function reportEscalation(input) {
        if (!deps.escalationsEnabled())
            return "off";
        try {
            const { bot, threadId } = input;
            if (deps.quietThread?.(bot.id, threadId))
                return "skipped";
            if (input.kind === "needs-input" && deps.assignerOf(threadId))
                return "skipped";
            const task = store.taskByThread(bot.id, threadId);
            const group = store.groupByThread(threadId);
            const escalation = {
                kind: input.kind,
                bot,
                threadId,
                title: task?.title ?? null,
                room: group?.name ?? null,
                gate: input.gate,
                reason: redactSecretsInText(input.reason),
            };
            const count = escalationLedger.note(threadId);
            if (count.muted)
                return "muted";
            const chief = chiefForBot(store.bots, bot);
            return deliver({
                chief: chief && escalationDeliverable(chief, bot) ? chief : null, title: ESCALATIONS_THREAD_TITLE, bot, threadId,
                chip: escalationChip(escalation), text: escalationText(escalation, count), alreadyNotified: input.alreadyNotified,
            });
        }
        catch (error) {
            console.warn(`escalation for thread ${input.threadId} not delivered: ${error instanceof Error ? error.message : String(error)}`);
            return "failed";
        }
    }
    return { reportIncident, reportEscalation, incidentRefused, incidentLastAt: (threadId) => incidentLedger.lastAt(threadId) };
}
