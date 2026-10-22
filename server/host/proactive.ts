// The proactive main agent, wired from ordinary routines: the checks a routine runs before any AI turn, the
// read-and-draft fence its runs work inside, and the brief its results become.
import type { NeedsYouItem } from "../../shared/today.ts";
import type { RuntimeEvent } from "../../shared/runtime-events.ts";
import { connectorAccessDecision } from "../../shared/connector-scopes.ts";
import type { Notification } from "../../shared/notification.ts";
import type { AppConfig } from "../config.ts";
import { createConnectedReads, READ_APPS, type ReadApp } from "../connected-reads.ts";
import { evaluateConnectorTools } from "../connector-verdict.ts";
import type { DecisionRow } from "../decision-log.ts";
import type { ProviderAdapter } from "../contracts.ts";
import { createReadAndDraft } from "../read-and-draft.ts";
import type { RoutineChecks, RoutineManager, RoutineRun } from "../routines.ts";
import type { BotRecord, Store } from "../store.ts";
import { createBrief, type BriefDeps } from "./brief.ts";
import { createRoutineChecks } from "./routine-checks.ts";

/** The engines whose every tool use outside a run's allowlist reaches OpenMausBot's answerer and is refused there. */
const FENCED_ENGINES = new Set(["claudeAgent"]);
const READ_SLUG: Record<ReadApp, string> = { gmail: "GMAIL_FETCH_EMAILS", googlecalendar: "GOOGLECALENDAR_EVENTS_LIST" };

type RequestOpened = Extract<RuntimeEvent, { type: "request.opened" }>;

export interface ProactiveDeps {
  store: Store;
  cfg: AppConfig;
  composio: {
    configured(cfg: AppConfig): boolean;
    connectedServices(cfg: AppConfig): Promise<Record<string, { connected: boolean }>>;
    relayMcp(cfg: AppConfig, payload: never, transportSessionId?: string, beforeSend?: () => void, signal?: AbortSignal): Promise<{ status: number; bytes: Uint8Array; transportSessionId?: string }>;
  };
  registry: { get(instanceId: string): { driverKind: string; adapter: ProviderAdapter } | null | undefined };
  dataDir: string;
  /** A hosted team workspace or a Team Cloud. */
  team: boolean;
  routines(): RoutineManager | null;
  mainThread: BriefDeps["mainThread"];
  threadBusy: BriefDeps["threadBusy"];
  notify(notification: Notification | null): void;
  engineName(instanceId: string): string;
  needsYou(): NeedsYouItem[];
  hostTimeZone(): string | undefined;
  decide(row: Omit<DecisionRow, "at">): void;
  stale(event: RequestOpened): boolean;
  release(threadId: string): void;
}

export function createProactive(deps: ProactiveDeps) {
  const { store, cfg, composio } = deps;
  const reads = createConnectedReads({
    connected: async () => {
      if (!composio.configured(cfg)) return null;
      const services = await composio.connectedServices(cfg);
      return Object.fromEntries(READ_APPS.map((app) => [app, services[app]?.connected === true])) as Record<ReadApp, boolean>;
    },
    relay: (payload, session, signal) => composio.relayMcp(cfg, payload as never, session, undefined, signal),
  });

  /** Connected apps are on for this bot, and its own app switches and tool grants let it read this app. */
  function mayRead(botId: string, app: ReadApp): boolean {
    const bot = store.bot(botId);
    if (!bot || bot.composio === false || !composio.configured(cfg)) return false;
    const slug = READ_SLUG[app];
    return connectorAccessDecision(bot.connectorScopes, [{ slug }], [...READ_APPS]).ok && evaluateConnectorTools([slug], bot.connectorTools, [...READ_APPS]).allowed;
  }
  const fenced = (botId: string): boolean => {
    const bot = store.bot(botId);
    return Boolean(bot && FENCED_ENGINES.has(deps.registry.get(bot.modelSelection.instanceId)?.driverKind ?? ""));
  };
  const runs = (): RoutineRun[] => [...(deps.routines()?.listRuns() ?? [])].reverse();

  const brief = createBrief({
    store, dataDir: deps.dataDir, hosted: deps.team, mainThread: deps.mainThread, threadBusy: deps.threadBusy, runs,
    needsYou: deps.needsYou, engineName: deps.engineName, hostTimeZone: deps.hostTimeZone,
    notify: (bot, threadId, detail) => deps.notify(briefNotification(bot, threadId, detail)),
    session: () => (composio.configured(cfg) ? reads.session() : null),
    address: () => checks.address(),
    failRun: (runId, why) => deps.routines()?.rejectResult(runId, why),
    keep: (key, prepped) => checks.commit(key, prepped),
    items: (key) => checks.items(key),
  });
  const checks = createRoutineChecks({
    dataDir: deps.dataDir, reads, mayRead, fenced, runs, timeZone: brief.timeZone, dismissedFrom: brief.dismissedFrom, report: brief.report,
  });
  /** One brief, the main agent's: a briefing routine of any other bot finds nothing to do. */
  const routineChecks: RoutineChecks = {
    check: (routine, context) => (deps.team || (routine.deliver === "brief" && routine.botId !== brief.chief()?.id) ? Promise.resolve({}) : checks.check(routine, context)),
    release: checks.release,
    settled: (run) => {
      checks.settled(run);
      if (run.deliver === "brief" && run.status === "failed") void brief.refresh();
    },
  };
  const fence = createReadAndDraft({
    runFor: (threadId) => deps.routines()?.runForThread(threadId) ?? null,
    adapter: (instanceId) => deps.registry.get(instanceId)?.adapter,
    stale: deps.stale, decide: deps.decide, release: deps.release,
    mayDraft: checks.mayDraft, drafted: checks.drafted,
  });

  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    checks: routineChecks, fence, brief,
    /** A routine run's turn ended: a briefing run's answer becomes the brief's rows. */
    runSettled: (run: RoutineRun, turnId: string | undefined): void => void brief.consume(run, turnId).catch((error: unknown) => console.warn("brief: a run's answer was not kept", error)),
    start(): void {
      if (timer || deps.team) return;
      timer = setInterval(() => brief.tick(), 60_000);
      timer.unref?.();
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

function briefNotification(bot: BotRecord, threadId: string, detail: string): Notification | null {
  if (bot.notifications === false) return null;
  return { kind: "brief", botId: bot.id, botName: bot.name, threadId, title: bot.name, body: detail.slice(0, 200), ...(bot.avatarUrl ? { avatarUrl: bot.avatarUrl } : {}) };
}

export type Proactive = ReturnType<typeof createProactive>;
