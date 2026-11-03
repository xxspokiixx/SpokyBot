// The proactive main agent, wired from ordinary routines: the checks a routine runs before any AI turn, the
// read-and-draft fence its runs work inside, the brief its results become, and the Chief's default "Keep an eye on my
// day" routine, created once with no button on a personal install or a personal Cloud that can reach connected apps,
// and never on a team's. The brief is there only while that routine is on.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connectorAccessDecision } from "../../shared/connector-scopes.js";
import { writeFileAtomic } from "../atomic.js";
import { createConnectedReads, READ_APPS } from "../connected-reads.js";
import { evaluateConnectorTools } from "../connector-verdict.js";
import { createReadAndDraft } from "../read-and-draft.js";
import { createBrief } from "./brief.js";
import { createRoutineChecks } from "./routine-checks.js";
export const WATCH_NAME = "Keep an eye on my day";
export const WATCH_INSTRUCTIONS = [
    "Keep an eye on my day for me.",
    "- Email: pick what I must not miss: mail that needs my reply, mail from someone I meet today, and anything with a deadline. Leave out newsletters, receipts and notifications.",
    "- Meetings: before a meeting with other people, prepare me in a few lines: who they are, why we are meeting, what is still open, and one next step.",
].join("\n");
const WATCH_FILE = "watch.json";
/** The engines whose every tool use outside a run's allowlist reaches SpokyBot's answerer and is refused there. */
const FENCED_ENGINES = new Set(["claudeAgent"]);
const READ_SLUG = { gmail: "GMAIL_FETCH_EMAILS", googlecalendar: "GOOGLECALENDAR_EVENTS_LIST" };
export function createProactive(deps) {
    const { store, cfg, composio } = deps;
    const reads = createConnectedReads({
        connected: async () => {
            if (!composio.configured(cfg))
                return null;
            const services = await composio.connectedServices(cfg);
            return Object.fromEntries(READ_APPS.map((app) => [app, services[app]?.connected === true]));
        },
        relay: (payload, session, signal) => composio.relayMcp(cfg, payload, session, undefined, signal),
    });
    /** Connected apps are on for this bot, and its own app switches and tool grants let it read this app. */
    function mayRead(botId, app) {
        const bot = store.bot(botId);
        if (!bot || bot.composio === false || !composio.configured(cfg))
            return false;
        const slug = READ_SLUG[app];
        return connectorAccessDecision(bot.connectorScopes, [{ slug }], [...READ_APPS]).ok && evaluateConnectorTools([slug], bot.connectorTools, [...READ_APPS]).allowed;
    }
    const fenced = (botId) => {
        const bot = store.bot(botId);
        return Boolean(bot && FENCED_ENGINES.has(deps.registry.get(bot.modelSelection.instanceId)?.driverKind ?? ""));
    };
    const runs = () => [...(deps.routines()?.listRuns() ?? [])].reverse();
    /** The Chief's briefing routine is on: pausing or deleting it switches the brief off. */
    const watching = () => {
        const chief = brief.chief();
        return Boolean(chief && deps.routines()?.listRoutines().some((routine) => routine.botId === chief.id && routine.deliver === "brief" && routine.enabled));
    };
    const brief = createBrief({
        store, dataDir: deps.dataDir, hosted: deps.team, watching, mainThread: deps.mainThread, threadBusy: deps.threadBusy, runs,
        needsYou: deps.needsYou, engineName: deps.engineName, hostTimeZone: deps.hostTimeZone,
        notify: (bot, threadId, detail) => deps.notify(briefNotification(bot, threadId, detail)),
        session: () => (composio.configured(cfg) ? reads.session() : null),
        address: () => checks.address(),
        failRun: (runId, why) => deps.routines()?.rejectResult(runId, why),
        keep: (key) => checks.commit(key),
        items: (key) => checks.items(key),
    });
    const checks = createRoutineChecks({
        dataDir: deps.dataDir, reads, mayRead, fenced, runs, timeZone: brief.timeZone, dismissedFrom: brief.dismissedFrom, report: brief.report,
    });
    /** One brief, the main agent's: a briefing routine of any other bot finds nothing to do. */
    const routineChecks = {
        check: (routine, context) => (deps.team || (routine.deliver === "brief" && routine.botId !== brief.chief()?.id) ? Promise.resolve({}) : checks.check(routine, context)),
        release: checks.release,
        settled: (run) => {
            checks.settled(run);
            if (run.deliver === "brief" && run.status === "failed")
                void brief.refresh();
        },
    };
    const fence = createReadAndDraft({
        runFor: (threadId) => deps.routines()?.runForThread(threadId) ?? null,
        adapter: (instanceId) => deps.registry.get(instanceId)?.adapter,
        stale: deps.stale, decide: deps.decide, release: deps.release,
        mayDraft: checks.mayDraft, drafted: checks.drafted,
    });
    const watchFile = join(deps.dataDir, WATCH_FILE);
    let made;
    const watchMade = () => {
        if (made === undefined) {
            try {
                made = Boolean(JSON.parse(readFileSync(watchFile, "utf8")).createdAt);
            }
            catch {
                made = false;
            }
        }
        return made;
    };
    /** The Chief's default routine, once, when connected apps are there to read: pausing or deleting it is how it is
     * switched off, so it is never made again. Asked at start and every minute, since a Cloud's access arrives later. */
    function ensureWatch() {
        const manager = deps.routines();
        const chief = brief.chief();
        if (deps.team || !composio.configured(cfg) || !manager || !chief || watchMade())
            return null;
        const existing = manager.listRoutines().find((routine) => routine.botId === chief.id && routine.deliver === "brief" && routine.checks?.length);
        const routine = existing ?? manager.create({
            name: WATCH_NAME, prompt: WATCH_INSTRUCTIONS, botId: chief.id, enabled: true, timeoutMinutes: 15,
            schedule: { type: "interval", everyMinutes: 15, anchorAt: Date.now() + 15 * 60_000 },
            checks: ["calendar", "mail", "runs"], access: "read-and-draft", deliver: "brief",
        });
        if (!existing)
            deps.owned(routine);
        made = true;
        try {
            writeFileAtomic(watchFile, `${JSON.stringify({ version: 1, routineId: routine.id, createdAt: Date.now() })}\n`, { mode: 0o600 });
        }
        catch (error) {
            console.warn(`watch: could not save ${watchFile}: ${error instanceof Error ? error.message : String(error)}`);
        }
        return routine;
    }
    let timer = null;
    return {
        checks: routineChecks, fence, brief,
        ensureWatch,
        /** A routine run's turn ended: a briefing run's answer becomes the brief's rows. */
        runSettled: (run, turnId) => void brief.consume(run, turnId).catch((error) => console.warn("brief: a run's answer was not kept", error)),
        start() {
            if (timer || deps.team)
                return;
            timer = setInterval(() => {
                brief.tick();
                try {
                    ensureWatch();
                }
                catch (error) {
                    console.warn("watch: not made yet", error);
                }
            }, 60_000);
            timer.unref?.();
        },
        stop() {
            if (timer)
                clearInterval(timer);
            timer = null;
        },
    };
}
function briefNotification(bot, threadId, detail) {
    if (bot.notifications === false)
        return null;
    return { kind: "brief", botId: bot.id, botName: bot.name, threadId, title: bot.name, body: detail.slice(0, 200), ...(bot.avatarUrl ? { avatarUrl: bot.avatarUrl } : {}) };
}
