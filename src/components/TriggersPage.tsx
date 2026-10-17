import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, CalendarDays, CheckCheck, ChevronLeft, ChevronRight, CircleAlert, FileText, Loader2, Pause, Plus, Video, Webhook, X, Zap } from "lucide-react";

import { useDesktopCapabilities } from "@/components/DesktopCapabilities";
import { CalendarSidebar } from "@/components/routines/CalendarSidebar";
import { RoutineList } from "@/components/routines/RoutineList";
import { RoutineLogs } from "@/components/routines/RoutineLogs";
import type { CalendarCall } from "@/lib/calendar-calls";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { addDays, atLocalTime, calendarRangeLabel, projectedRoutineItems, scheduleAt, startOfDay, startOfWeek } from "@/lib/routine-calendar";
import { isRoutineProblemRun, type Routine, type RoutineRun, type RoutineRunStatusFilter } from "@/lib/routines";
import { niceTime, scheduleLabel } from "@/lib/schedule-label";
import { saveWebhookCredential, webhookCredentialStore } from "@/lib/webhook-credentials";
import type { WebhookTrigger } from "@/lib/webhooks";
import { api, useStore } from "@/state/store";
import {
  CalendarGrid, EventDetails, EventEditor, nextHour, PausedList, projectCalls, QuickComposer,
  type CalendarEventItem, type EventKind, type EventSeed, type RoutinesLayout,
} from "./RoutineCalendarPage";
import { Select } from "./Select";
import { Switch } from "./SettingsPrimitives";
import { WebhookDetails, WebhookEditor, WebhookTriggerList } from "./WebhookTrigger";

type KindFilter = "all" | "schedule" | "webhook";

/** The one place for every trigger: schedules (routines) and webhooks, as a list, a calendar and a run history. */
export function TriggersPage({ onBack, onOpenRoom }: { onBack: () => void; onOpenRoom: (id: string) => void }) {
  const { state, dispatch } = useStore();
  const { capabilities } = useDesktopCapabilities();
  const advanced = useAdvancedMode();
  const routinesOnly = window.ogb?.remoteClient?.active === true;
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const focus = state.routinesFocus;
  const [section, setSection] = useState<"calendar" | "logs">(focus?.section === "logs" ? "logs" : "calendar");
  const [layout, setLayout] = useState<RoutinesLayout>(focus?.view === "calendar" ? "week" : "list");
  const [kind, setKind] = useState<KindFilter>("all");
  const [anchor, setAnchor] = useState(() => startOfDay(Date.now()));
  const [botFilter, setBotFilter] = useState(focus?.botId ?? "all");
  const [routineFilter, setRoutineFilter] = useState<string | undefined>(focus?.section === "logs" ? focus.routineId : undefined);
  const [statusFilter, setStatusFilter] = useState<RoutineRunStatusFilter>(focus?.runStatus ?? "all");
  const [calls, setCalls] = useState<CalendarCall[]>([]);
  const [quick, setQuick] = useState<EventSeed | null>(null);
  const [editor, setEditor] = useState<EventSeed | null>(null);
  const [selected, setSelected] = useState<CalendarEventItem | null>(null);
  const [webhookId, setWebhookId] = useState<string | null>(null);
  const [webhookEditor, setWebhookEditor] = useState<WebhookTrigger | "new" | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [pausedOpen, setPausedOpen] = useState(false);
  const [error, setError] = useState("");
  const visibleBots = state.bots.filter((bot) => !bot.hidden);
  const webhooksShown = !routinesOnly;
  const viewDays = layout === "day" ? 1 : 7;
  const rangeStart = viewDays === 7 ? startOfWeek(anchor) : startOfDay(anchor);
  const rangeEnd = addDays(rangeStart, viewDays);
  const datedView = section === "calendar" && layout !== "list";

  const routineAt = (routine: Routine) => routine.schedule.type === "once"
    ? routine.schedule.at
    : routine.schedule.type === "interval"
      ? routine.schedule.anchorAt
      : routine.schedule.type === "cron"
        ? routine.nextRunAt ?? nextHour()
        : atLocalTime(Date.now(), routine.schedule.time);
  const openRoutine = (routine: Routine) => {
    setWebhookId(null);
    setSelected({ kind: "routine", id: routine.id, at: routine.nextRunAt ?? routineAt(routine), durationMinutes: routine.durationMinutes, routine, run: null });
  };
  const openWebhook = (webhook: WebhookTrigger) => { setSelected(null); setWebhookId(webhook.id); };

  useEffect(() => {
    setSection(focus?.section === "logs" ? "logs" : "calendar");
    setLayout(focus?.view === "calendar" ? "week" : "list");
    setBotFilter(focus?.botId ?? "all");
    setRoutineFilter(focus?.section === "logs" ? focus.routineId : undefined);
    setStatusFilter(focus?.runStatus ?? "all");
    // "Open in Triggers" from a chat card names the trigger: open its drawer.
    if (focus?.section !== "logs" && focus?.routineId) {
      const routine = state.routines.find((candidate) => candidate.id === focus.routineId);
      const webhook = state.webhooks.find((candidate) => candidate.id === focus.routineId);
      if (routine) openRoutine(routine);
      else if (webhook) openWebhook(webhook);
    }
  }, [focus]);

  const loadCalls = useCallback(async () => {
    try {
      const response = await api("/api/calendar-calls");
      setCalls(response.calls ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);
  useEffect(() => { if (!routinesOnly) void loadCalls(); }, [loadCalls, routinesOnly]);
  useEffect(() => { backButtonRef.current?.focus({ preventScroll: true }); }, []);

  const items = useMemo<CalendarEventItem[]>(() => {
    const routineItems = projectedRoutineItems(state.routines, state.routineRuns, rangeStart, rangeEnd).map((item) => ({ ...item, kind: "routine" as const }));
    const now = Date.now();
    const pausedRoutines = state.routines.filter((routine) => !routine.enabled);
    const pausedItems = projectedRoutineItems(pausedRoutines.map((routine) => ({ ...routine, enabled: true })), state.routineRuns, rangeStart, rangeEnd)
      .filter((item) => !item.run && item.at >= now)
      .map((item) => ({ ...item, id: `paused-${item.id}`, routine: pausedRoutines.find((routine) => routine.id === item.routine?.id) ?? item.routine, kind: "routine" as const }));
    const callItems = projectCalls(calls, rangeStart, rangeEnd).map((item) => ({ ...item, kind: "call" as const }));
    return [...routineItems, ...pausedItems, ...callItems]
      .filter((item) => botFilter === "all" || (item.kind === "call" ? item.call.botIds.includes(botFilter) : (item.routine?.botId ?? item.run?.botId) === botFilter))
      .sort((left, right) => left.at - right.at);
  }, [state.routines, state.routineRuns, calls, rangeStart, rangeEnd, botFilter]);

  const liveSelected = selected?.kind === "call"
    ? (() => { const call = calls.find((candidate) => candidate.id === selected.call.id); return call ? { ...selected, call } : null; })()
    : selected?.kind === "routine"
      ? { ...selected, routine: selected.routine ? state.routines.find((routine) => routine.id === selected.routine?.id) ?? null : null, run: selected.run ? state.routineRuns.find((run) => run.id === selected.run?.id) ?? selected.run : null }
      : null;
  const liveWebhook = webhookId ? state.webhooks.find((webhook) => webhook.id === webhookId) ?? null : null;
  const paused = state.routines.filter((routine) => !routine.enabled && (routine.schedule.type !== "once" || routine.schedule.at > Date.now()));
  const running = state.routineRuns.filter((run) => ["queued", "running", "waiting"].includes(run.status)).length;
  const unseenFailures = state.routineRuns.filter((run) => isRoutineProblemRun(run) && !run.seenAt).length;
  const filteredRoutines = state.routines.filter((routine) => botFilter === "all" || routine.botId === botFilter);
  const filteredWebhooks = webhooksShown ? state.webhooks.filter((webhook) => botFilter === "all" || webhook.botId === botFilter) : [];
  const filteredRuns = state.routineRuns.filter((run) => botFilter === "all" || run.botId === botFilter);
  const nothingYet = state.routines.length === 0 && filteredWebhooks.length === 0 && state.routinesLoadState !== "loading";
  const openLogs = (routine: Routine) => { setRoutineFilter(routine.id); setSection("logs"); };
  const openRun = (run: RoutineRun) => {
    setWebhookId(null);
    setSelected({ kind: "routine", id: run.id, at: run.scheduledFor, durationMinutes: run.durationMinutes ?? 30, routine: state.routines.find((routine) => routine.id === run.routineId) ?? null, run });
    if (["failed", "missed"].includes(run.status) && !run.seenAt) dispatch({ type: "markRoutineRunSeen", runId: run.id });
  };
  const openItem = (item: CalendarEventItem) => {
    setWebhookId(null);
    setSelected(item);
    if (item.kind === "routine" && item.run && ["failed", "missed"].includes(item.run.status) && !item.run.seenAt) dispatch({ type: "markRoutineRunSeen", runId: item.run.id });
  };
  const macInset = capabilities.windowChrome === "mac-inset";
  const windowDragStyle = macInset ? ({ WebkitAppRegion: "drag" } as CSSProperties) : undefined;
  const windowNoDragStyle = macInset ? ({ WebkitAppRegion: "no-drag" } as CSSProperties) : undefined;

  const showLayout = (next: RoutinesLayout) => {
    setSection("calendar");
    setLayout(next);
    setAnchor((current) => startOfDay(current));
  };
  const goToday = useCallback(() => setAnchor(startOfDay(Date.now())), []);
  const openCreate = useCallback((seed?: Partial<EventSeed>) => {
    setSelected(null);
    setWebhookId(null);
    setQuick({ kind: "routine", at: nextHour(), durationMinutes: 30, botIds: [], ...seed });
  }, []);
  const createSchedule = () => {
    setChoosing(false);
    if (advanced) return openCreate({ kind: "routine" });
    setSelected(null);
    setEditor({ kind: "routine", at: nextHour(), durationMinutes: 30, botIds: botFilter !== "all" ? [botFilter] : [] });
  };
  const createWebhook = () => { setChoosing(false); setWebhookEditor("new"); };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "Escape") { setQuick(null); setEditor(null); setSelected(null); setWebhookId(null); setChoosing(false); return; }
      if (section !== "calendar" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() === "c") { event.preventDefault(); setChoosing(true); }
      if (event.key.toLowerCase() === "t") goToday();
      if (event.key === "1" || event.key.toLowerCase() === "d") showLayout("day");
      if (event.key.toLowerCase() === "w") showLayout("week");
      if (event.key.toLowerCase() === "l") showLayout("list");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [section, goToday, anchor]);

  const upsertCall = (call: CalendarCall) => setCalls((current) => current.some((candidate) => candidate.id === call.id) ? current.map((candidate) => candidate.id === call.id ? call : candidate) : [call, ...current]);
  const moveEvent = async (dragged: { kind: EventKind; id: string; at: number }, nextAt: number) => {
    if (nextAt === dragged.at) return;
    try {
      if (dragged.kind === "routine") {
        const routine = state.routines.find((candidate) => candidate.id === dragged.id);
        if (!routine) return;
        if (routine.schedule.type === "cron") throw new Error("Open this routine to edit its repeating schedule and time zone.");
        if (routine.schedule.type !== "once" && !window.confirm("Move this entire recurring series?")) return;
        const response = await api(`/api/routines/${routine.id}`, { method: "PATCH", body: JSON.stringify({ schedule: scheduleAt(routine.schedule, dragged.at, nextAt) }) });
        dispatch({ type: "routinePatched", routine: response.routine });
      } else {
        const call = calls.find((candidate) => candidate.id === dragged.id);
        if (!call) return;
        if (call.schedule.type === "daily" && !window.confirm("Move this entire recurring series?")) return;
        const response = await api(`/api/calendar-calls/${call.id}`, { method: "PATCH", body: JSON.stringify({ schedule: scheduleAt(call.schedule, dragged.at, nextAt) }) });
        upsertCall(response.call);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const resizeEvent = async (item: CalendarEventItem, durationMinutes: number) => {
    try {
      if (item.kind === "routine" && item.routine) {
        const response = await api(`/api/routines/${item.routine.id}`, { method: "PATCH", body: JSON.stringify({ durationMinutes }) });
        dispatch({ type: "routinePatched", routine: response.routine });
      } else if (item.kind === "call") {
        const response = await api(`/api/calendar-calls/${item.call.id}`, { method: "PATCH", body: JSON.stringify({ durationMinutes }) });
        upsertCall(response.call);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const editSelected = () => {
    if (!liveSelected) return;
    const seed: EventSeed = liveSelected.kind === "call"
      ? { kind: "call", at: liveSelected.at, durationMinutes: liveSelected.call.durationMinutes, botIds: liveSelected.call.botIds, call: liveSelected.call }
      : { kind: "routine", at: liveSelected.at, durationMinutes: liveSelected.routine?.durationMinutes ?? liveSelected.run?.durationMinutes ?? 30, botIds: [liveSelected.routine?.botId ?? liveSelected.run?.botId ?? ""].filter(Boolean), routine: liveSelected.routine ?? undefined };
    setSelected(null);
    setEditor(seed);
  };
  const segment = (active: boolean) => cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium", active ? "bg-raised text-ink shadow-sm" : "text-ink-secondary hover:text-ink");
  const chip = (active: boolean) => cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px]", active ? "border-accent/50 bg-accent/10 text-ink" : "border-hairline/50 text-ink-secondary hover:bg-raised");
  const kinds: Array<[KindFilter, string, number]> = [["all", t("triggers.kind.all"), filteredRoutines.length + filteredWebhooks.length], ["schedule", t("triggers.kind.schedules"), filteredRoutines.length], ["webhook", t("triggers.kind.webhooks"), filteredWebhooks.length]];

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-app animate-workspace-in">
      <header className={cn("shrink-0 border-b border-hairline/35 bg-app py-3 pr-4", macInset ? "pl-[86px]" : "pl-4")} style={windowDragStyle}>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" ref={backButtonRef} onClick={onBack} aria-label="Back" title="Back" className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink" style={windowNoDragStyle}><ArrowLeft size={18} /></button>
          <h1 data-tour="automations-page" className="mr-1 text-[18px] font-semibold tracking-tight text-ink">{t("triggers.title")}</h1>
          {datedView && (
            <div className="flex min-w-0 items-center gap-1" style={windowNoDragStyle}>
              <button type="button" onClick={() => setAnchor((current) => addDays(current, -viewDays))} className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink" aria-label={t("routines.previous")}><ChevronLeft size={16} /></button>
              <button type="button" onClick={() => setAnchor((current) => addDays(current, viewDays))} className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink" aria-label={t("routines.next")}><ChevronRight size={16} /></button>
              <div className="min-w-0 truncate px-1 text-[14px] font-medium text-ink" aria-live="polite">{calendarRangeLabel(rangeStart, viewDays)}</div>
              <button type="button" onClick={goToday} className="ml-1 rounded-lg border border-hairline/50 bg-panel px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-raised">{t("routines.today")}</button>
            </div>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2" style={windowNoDragStyle}>
            <div role="group" className="flex items-center rounded-lg border border-hairline/50 bg-panel p-0.5" aria-label={t("routines.view.label")}>
              <button type="button" aria-pressed={section === "calendar" && layout === "list"} onClick={() => showLayout("list")} className={segment(section === "calendar" && layout === "list")}>{t("routines.view.list")}</button>
              <button type="button" aria-pressed={section === "calendar" && layout === "day"} onClick={() => showLayout("day")} className={segment(section === "calendar" && layout === "day")}>{t("routines.view.day")}</button>
              <button type="button" aria-pressed={section === "calendar" && layout === "week"} onClick={() => showLayout("week")} className={segment(section === "calendar" && layout === "week")}>{t("routines.view.week")}</button>
            </div>
            <button type="button" aria-pressed={section === "logs"} onClick={() => { if (section === "logs") { setSection("calendar"); return; } setSection("logs"); setRoutineFilter(undefined); }} className={cn("flex items-center gap-1.5 rounded-lg border border-hairline/50 px-2.5 py-1.5 text-[12px] font-medium", section === "logs" ? "bg-raised text-ink" : "bg-panel text-ink-secondary hover:text-ink")}><FileText size={13} />{t("triggers.history")}{unseenFailures > 0 && <span className="rounded-full bg-danger/10 px-1.5 text-[9px] text-danger">{unseenFailures}</span>}</button>
            <div className="relative">
              <button type="button" aria-haspopup="menu" aria-expanded={choosing} onClick={() => setChoosing((open) => !open)} className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[12px] font-semibold text-accent-ink hover:brightness-110"><Plus size={15} aria-hidden="true" />{t("triggers.new")}</button>
              {choosing && (
                <div role="menu" aria-label={t("triggers.new")} className="absolute right-0 top-full z-40 mt-1.5 w-[300px] rounded-xl border border-hairline/50 bg-card p-1.5 shadow-2xl">
                  <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-tertiary">{t("triggers.page.when")}</div>
                  <button type="button" role="menuitem" onClick={createSchedule} className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-raised"><CalendarDays size={16} className="mt-0.5 shrink-0 text-accent" /><span><span className="block text-[13px] font-medium text-ink">{t("triggers.new.schedule")}</span><span className="block text-[11px] text-ink-secondary">{t("triggers.new.scheduleHint")}</span></span></button>
                  {webhooksShown && <button type="button" role="menuitem" disabled={visibleBots.length === 0} onClick={createWebhook} className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-raised disabled:opacity-40"><Webhook size={16} className="mt-0.5 shrink-0 text-accent" /><span><span className="block text-[13px] font-medium text-ink">{t("triggers.new.webhook")}</span><span className="block text-[11px] text-ink-secondary">{t("triggers.new.webhookHint")}</span></span></button>}
                  <p className="border-t border-hairline/40 px-2.5 pb-1 pt-2 text-[11px] leading-relaxed text-ink-secondary">{t("triggers.new.chatTip")}</p>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2" style={windowNoDragStyle}>
          {section === "calendar" && layout === "list" && webhooksShown && kinds.map(([value, label, count]) => <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)} className={chip(kind === value)}>{label}<span className="tabular-nums text-ink-tertiary">{count}</span></button>)}
          {unseenFailures > 0 && <button type="button" onClick={() => dispatch({ type: "markAllRoutineRunsSeen" })} className="flex items-center gap-1.5 rounded-lg border border-hairline/50 bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-secondary hover:bg-raised hover:text-ink" title={t("routines.markAllSeen")} aria-label={t("routines.markAllSeen")}><CheckCheck size={12} />{t("routines.markAllSeen")}</button>}
          {running > 0 && <span className="flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1.5 text-[10.5px] text-accent-text"><Loader2 size={11} className="animate-spin" />{running} active</span>}
          {unseenFailures > 0 && <button type="button" onClick={() => dispatch({ type: "showRoutines", section: "logs", runStatus: "problems" })} className="flex items-center gap-1.5 rounded-full bg-danger/10 px-2.5 py-1.5 text-[10.5px] text-danger" title="Open problem run logs" aria-label="Open problem run logs"><CircleAlert size={11} />{unseenFailures}</button>}
          {paused.length > 0 && <button type="button" onClick={() => setPausedOpen(true)} aria-label="View paused routines" className="flex items-center gap-1.5 rounded-full border border-hairline/50 px-2.5 py-1.5 text-[10.5px] text-ink-secondary hover:bg-raised"><Pause size={11} />{paused.length}</button>}
          <div className="ml-auto flex items-center gap-2">
            <Select size="sm" aria-label="Filter triggers by bot" value={botFilter} onChange={(event) => { setBotFilter(event.target.value); setRoutineFilter(undefined); }} className="max-w-[180px]"><option value="all">All bots</option>{visibleBots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</Select>
          </div>
          {error && <button type="button" onClick={() => setError("")} className="flex items-center gap-1.5 rounded-lg bg-danger/10 px-2.5 py-1.5 text-[10.5px] text-danger"><CircleAlert size={11} />{error}<X size={11} /></button>}
          {datedView && state.routinesLoadState === "error" && <p role="alert" className="w-full text-[11.5px] text-danger">{t("routines.loadError")}</p>}
        </div>
      </header>
      <RoutineWakeBar />

      <div className="@container/routines relative flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {section === "logs" ? (
            <div className="min-h-0 flex-1 overflow-y-auto"><RoutineLogs runs={filteredRuns} bots={state.bots} loading={state.routinesLoadState === "loading" && filteredRuns.length === 0} error={state.routinesLoadState === "error"} routineId={routineFilter} status={statusFilter} onStatusChange={setStatusFilter} onClearRoutine={() => setRoutineFilter(undefined)} onOpen={openRun} /></div>
          ) : layout === "list" ? (
            <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-4xl space-y-5 p-4 sm:p-6">
              <p className="text-[12.5px] text-ink-secondary">{t("triggers.page.subtitle")}</p>
              {nothingYet ? (
                <section className="rounded-2xl border border-dashed border-hairline/50 px-6 py-12 text-center" aria-label={t("triggers.empty.title")}>
                  <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-2xl bg-accent/10 text-accent"><Zap size={20} /></div>
                  <h2 className="text-[16px] font-semibold text-ink">{t("triggers.empty.title")}</h2>
                  <p className="mx-auto mt-2 max-w-[440px] text-[12.5px] leading-relaxed text-ink-secondary">{t("triggers.empty.body")}</p>
                  <p className="mx-auto mt-3 max-w-[440px] text-[12px] leading-relaxed text-ink">{t("triggers.empty.try")}</p>
                  <button type="button" onClick={() => setChoosing(true)} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-ink hover:brightness-110"><Plus size={15} />{t("triggers.new")}</button>
                </section>
              ) : (
                <>
                  {kind !== "webhook" && <section className="space-y-2" aria-label={t("triggers.kind.schedules")}>{kind === "all" && <h2 className="text-[13px] font-semibold text-ink">{t("triggers.kind.schedules")}</h2>}<RoutineList routines={filteredRoutines} runs={state.routineRuns} bots={state.bots} loading={state.routinesLoadState === "loading" && filteredRoutines.length === 0} error={state.routinesLoadState === "error"} onOpen={openRoutine} onLogs={openLogs} onToggle={(routine) => dispatch({ type: "updateRoutine", routineId: routine.id, patch: { enabled: !routine.enabled } })} /></section>}
                  {kind !== "schedule" && filteredWebhooks.length > 0 && <section className="space-y-2" aria-label={t("triggers.kind.webhooks")}>{kind === "all" && <h2 className="text-[13px] font-semibold text-ink">{t("triggers.kind.webhooks")}</h2>}<WebhookTriggerList webhooks={filteredWebhooks} bots={state.bots} selectedId={webhookId ?? undefined} onOpen={openWebhook} /></section>}
                  {kind === "all" && !routinesOnly && calls.some((call) => botFilter === "all" || call.botIds.includes(botFilter)) && <section className="space-y-2" aria-label="Scheduled calls"><h2 className="text-[13px] font-semibold text-ink">Scheduled calls</h2>{calls.filter((call) => botFilter === "all" || call.botIds.includes(botFilter)).map((call) => <button key={call.id} type="button" onClick={() => setSelected({ kind: "call", id: call.id, at: call.schedule.type === "once" ? call.schedule.at : atLocalTime(Date.now(), call.schedule.time), durationMinutes: call.durationMinutes, call })} className="flex w-full items-center gap-3 rounded-xl border border-hairline/40 bg-card p-4 text-left hover:bg-raised"><Video size={17} className="text-accent" /><span><span className="block text-[13px] font-medium text-ink">{call.name}</span><span className="mt-1 block text-[11.5px] text-ink-secondary">{scheduleLabel(call.schedule)}</span></span></button>)}</section>}
                </>
              )}
            </div></div>
          ) : (
            <div className="flex min-h-0 flex-1">
              {!liveSelected && <div className="hidden shrink-0 @min-[1040px]/routines:block"><CalendarSidebar bots={visibleBots} anchor={anchor} onSelectDate={(at) => setAnchor(startOfDay(at))} /></div>}
              <CalendarGrid anchor={rangeStart} days={viewDays} items={items} bots={state.bots} groups={state.groups} selectedId={liveSelected?.id} onOpen={openItem} onCreate={openCreate} onMove={(item, at) => void moveEvent(item, at)} onResize={(item, duration) => void resizeEvent(item, duration)} />
            </div>
          )}
        </div>
        {(liveSelected || liveWebhook) && (
          <div className="absolute inset-y-0 right-0 z-30 flex shadow-2xl @min-[760px]/routines:static @min-[760px]/routines:shadow-none">
            {liveSelected
              ? <EventDetails key={`${liveSelected.kind}:${liveSelected.id}`} item={liveSelected} bots={state.bots} onClose={() => setSelected(null)} onEdit={editSelected} onOpenRun={openRun} onCallChanged={(id) => { if (id) setCalls((current) => current.filter((call) => call.id !== id)); else void loadCalls(); }} onOpenRoom={onOpenRoom} />
              : <WebhookDetails key={liveWebhook!.id} webhook={liveWebhook!} bots={state.bots} onClose={() => setWebhookId(null)} onEdit={() => setWebhookEditor(liveWebhook)} />}
          </div>
        )}
      </div>

      {choosing && <div className="fixed inset-0 z-30" onMouseDown={() => setChoosing(false)} />}
      {quick && <><div className="fixed inset-0 z-40 bg-black/25" onMouseDown={() => setQuick(null)} /><QuickComposer seed={quick} bots={visibleBots} routinesOnly={routinesOnly} onClose={() => setQuick(null)} onMore={(seed) => { setQuick(null); setEditor(seed); }} onSavedRoutine={(routine) => dispatch({ type: "routinePatched", routine })} onSavedCall={upsertCall} /></>}
      {editor && <EventEditor seed={editor} bots={visibleBots} routinesOnly={routinesOnly} onClose={() => setEditor(null)} onSavedCall={upsertCall} />}
      {webhookEditor && <WebhookEditor webhook={webhookEditor === "new" ? undefined : webhookEditor} bots={visibleBots} onClose={() => setWebhookEditor(null)} onCredential={(credential, id) => { saveWebhookCredential(webhookCredentialStore(), id, credential); setSelected(null); setWebhookId(id); }} />}
      {pausedOpen && <PausedList routines={paused} bots={state.bots} groups={state.groups} onClose={() => setPausedOpen(false)} onEdit={(routine) => { setPausedOpen(false); setEditor({ kind: "routine", at: routineAt(routine), durationMinutes: routine.durationMinutes, botIds: [routine.botId], routine }); }} onOpenRoom={onOpenRoom} />}
    </main>
  );
}

/**
 * While the Mac sleeps no schedule fires: the shell holds a power assertion the hour before a due routine and while one
 * runs, plugged in only.
 */
function RoutineWakeBar() {
  const bridge = typeof window !== "undefined" ? window.ogb?.routines : undefined;
  const [state, setState] = useState<DesktopRoutineWake | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    const load = () => bridge.wakeState().then((next) => { if (!cancelled) setState(next); }).catch(() => {});
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [bridge]);
  if (!bridge || !state) return null;
  const status = !state.keepAwake
    ? "Off — this computer may sleep through a scheduled routine."
    : state.onBattery
      ? "On battery, so not holding; plug in to keep it awake."
      : state.hold
        ? state.reason === "running" ? "Holding it awake now: a routine is running." : `Holding it awake now: a routine is due at ${state.at ? niceTime(state.at) : "the top of the hour"}.`
        : "Holds it awake for the hour before a routine and while one runs, while plugged in. A closed lid still sleeps.";
  return (
    <div className="flex items-center justify-between gap-4 border-b border-hairline/35 bg-panel/60 px-4 py-2.5">
      <div className="min-w-0 text-[12px] leading-relaxed text-ink-secondary">
        <span className="font-medium text-ink">Keep this computer awake for routines.</span> {status}
      </div>
      <Switch
        checked={state.keepAwake}
        disabled={busy}
        aria-label="Keep this computer awake for scheduled routines"
        onClick={() => {
          setBusy(true);
          bridge.keepAwake(!state.keepAwake).then(setState).catch(() => {}).finally(() => setBusy(false));
        }}
        className="shrink-0 disabled:cursor-wait disabled:opacity-50"
      />
    </div>
  );
}
