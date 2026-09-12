import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, BookOpen, Crown, Loader2, Network, Pencil, Plus, RefreshCw, Save, Trash2, Users, X } from "lucide-react";

import { BotAvatar } from "./Avatar";
import { api, formatTime, useStore, type Bot } from "@/state/store";
import { normalizeState } from "@/lib/mascot";
import {
  EMPTY_TEAM_MAP_SNAPSHOT,
  buildTeamMapEdges,
  buildTeamMapSections,
  teamMapStatus,
  type TeamMapEdge,
  type TeamMapSnapshot,
} from "@/lib/team-map";
import { cn } from "@/lib/cn";
import { BotInstructionsDialog } from "./BotInstructionsDialog";
import { TeamDialog } from "./TeamDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { t } from "@/lib/i18n";

const statusTone = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  idle: "bg-ink-secondary/35",
} as const;

function BotNode({
  bot,
  chief = false,
  onViewInstructions,
}: {
  bot: Bot;
  chief?: boolean;
  onViewInstructions: (bot: Bot) => void;
}) {
  const { dispatch } = useStore();
  const status = teamMapStatus(bot);
  return (
    <div className="group relative flex min-w-0 items-stretch overflow-hidden rounded-xl border border-hairline/50 bg-card shadow-sm transition hover:border-accent/35 hover:bg-raised/50">
      <button
        type="button"
        onClick={() => dispatch({ type: "select", id: bot.id })}
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left"
        aria-label={`Open chat with ${bot.name}`}
      >
        <BotAvatar
          bot={bot}
          state={normalizeState(bot.mascotExpression) ?? "idle"}
          size={34}
          motion="none"
          motionKey={0}
          animated={false}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13.5px] font-semibold text-ink">{bot.name}</span>
            {chief && <Crown size={12} className="shrink-0 text-warning" aria-label="Chief of Staff" />}
          </span>
          <span className="block truncate text-[11.5px] text-ink-secondary">{bot.title || bot.modelSelection.model}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[10.5px] text-ink-secondary">
          <span className={cn("size-1.5 rounded-full", statusTone[status.tone], status.label === "Working" && "animate-pulse")} />
          {status.label}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onViewInstructions(bot)}
        className="flex w-10 shrink-0 items-center justify-center border-l border-hairline/40 text-ink-secondary opacity-70 transition hover:bg-control hover:text-ink group-hover:opacity-100"
        aria-label={`View ${bot.name} instructions`}
        title="View instructions"
      >
        <BookOpen size={14} />
      </button>
    </div>
  );
}

function EdgeRow({ edge, bots }: { edge: TeamMapEdge; bots: Bot[] }) {
  const { dispatch } = useStore();
  const source = bots.find((bot) => bot.id === edge.sourceBotId);
  const target = bots.find((bot) => bot.id === edge.targetBotId);
  if (!source || !target) return null;
  const live = edge.state !== "connected";
  return (
    <button
      onClick={() => dispatch({ type: "select", id: edge.groupId ?? target.id })}
      className="flex w-full items-center gap-3 rounded-xl border border-hairline/40 bg-card px-3 py-2.5 text-left transition hover:bg-raised/50"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-[13px] font-medium text-ink">{source.name}</span>
        <ArrowRight size={13} className={cn("shrink-0", live ? "text-accent" : "text-ink-secondary")} />
        <span className="truncate text-[13px] font-medium text-ink">{target.name}</span>
      </div>
      {edge.reason && <span className="max-w-[220px] truncate text-[11.5px] text-ink-secondary">{edge.reason}</span>}
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-[10.5px] font-medium",
          edge.state === "running"
            ? "bg-success/15 text-success"
            : edge.state === "queued"
              ? "bg-warning/15 text-warning"
              : "bg-control text-ink-secondary",
        )}
      >
        {edge.state === "running" ? "Running" : edge.state === "queued" ? "Queued" : edge.lastAt ? formatTime(edge.lastAt) : "Connected"}
      </span>
    </button>
  );
}

interface SectionContextResponse {
  section: string;
  label: string;
  text: string;
  updatedAt: number | null;
  maxBytes: number;
}

function SectionContextDialog({ section, label, onClose }: { section: string; label: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const onCloseRef = useRef(onClose);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [maxBytes, setMaxBytes] = useState(24_000);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = text !== savedText;
  const bytes = useMemo(() => new TextEncoder().encode(text).byteLength, [text]);
  onCloseRef.current = onClose;
  savingRef.current = saving;
  dirtyRef.current = dirty;

  const requestClose = useCallback(() => {
    if (savingRef.current) return;
    if (dirtyRef.current && !window.confirm(t("team.instructionsDiscard"))) return;
    onCloseRef.current();
  }, []);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingRef.current) {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )];
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [requestClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api(`/api/section-context?section=${encodeURIComponent(section)}`)
      .then((result: SectionContextResponse) => {
        if (cancelled) return;
        setText(result.text);
        setSavedText(result.text);
        setUpdatedAt(result.updatedAt);
        setMaxBytes(result.maxBytes);
        window.setTimeout(() => textareaRef.current?.focus(), 0);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [section]);

  const save = async () => {
    if (bytes > maxBytes) return;
    setSaving(true);
    setError(null);
    try {
      const result: SectionContextResponse = await api(
        `/api/section-context?section=${encodeURIComponent(section)}`,
        { method: "PUT", body: JSON.stringify({ text }) },
      );
      setSavedText(result.text);
      setText(result.text);
      setUpdatedAt(result.updatedAt);
      setMaxBytes(result.maxBytes);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="section-context-title"
        tabIndex={-1}
        className="animate-pop-in flex max-h-[min(680px,calc(100dvh-2rem))] w-full max-w-[680px] flex-col overflow-hidden rounded-[24px] border border-hairline/50 bg-panel shadow-2xl shadow-black/50 outline-none"
      >
        <header className="flex items-start justify-between gap-4 border-b border-hairline/40 px-6 pb-4 pt-6 sm:px-8 sm:pt-7">
          <div>
            <div className="flex items-center gap-2">
              <BookOpen size={19} className="text-accent" />
              <h2 id="section-context-title" className="text-[20px] font-semibold tracking-[-0.01em] text-ink">
                {t("team.instructionsTitle", { name: label })}
              </h2>
            </div>
            <p className="mt-1.5 max-w-[520px] text-[12.5px] leading-relaxed text-ink-secondary">
              {t("team.instructionsHint")}
            </p>
          </div>
          <button
            onClick={requestClose}
            disabled={saving}
            aria-label={t("team.instructionsClose")}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40"
          >
            <X size={19} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-8">
          {loading ? (
            <div className="flex min-h-[260px] items-center justify-center text-ink-secondary">
              <Loader2 size={20} className="animate-spin" aria-label={t("team.instructionsLoading")} />
            </div>
          ) : (
            <>
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={"Goals\n- Ship the Windows onboarding refresh\n\nDecisions\n- Keep customer data local\n\nPreferences\n- Use concise weekly updates"}
                aria-label={t("team.instructionsTitle", { name: label })}
                className="min-h-[280px] w-full resize-y rounded-xl border border-hairline/60 bg-inset px-4 py-3 font-mono text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-ink-secondary/55 focus:border-accent/50"
              />
              <div className="mt-2 flex items-start justify-between gap-4 text-[11.5px] text-ink-secondary">
                <span>
                  Keep durable team facts here. Private notes stay in each bot's own Memory.
                  {updatedAt ? ` Last saved ${new Date(updatedAt).toLocaleString()}.` : ""}
                </span>
                <span className={cn("shrink-0 tabular-nums", bytes > maxBytes && "text-danger")}>
                  {bytes.toLocaleString()} / {maxBytes.toLocaleString()} bytes
                </span>
              </div>
            </>
          )}
          {error && <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-hairline/40 px-6 py-4 sm:px-8">
          <button onClick={requestClose} disabled={saving} className="rounded-lg px-3.5 py-2 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40">
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={loading || saving || !dirty || bytes > maxBytes}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-40"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {t("team.instructionsSave")}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

export function TeamMapPage() {
  const { state, dispatch } = useStore();
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const [snapshot, setSnapshot] = useState<TeamMapSnapshot>(EMPTY_TEAM_MAP_SNAPSHOT);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextEditor, setContextEditor] = useState<{ section: string; label: string } | null>(null);
  const [instructionsBot, setInstructionsBot] = useState<Bot | null>(null);
  const [teamEditor, setTeamEditor] = useState<{ section?: string; rename?: boolean } | null>(null);
  const [deletingTeam, setDeletingTeam] = useState<string | null>(null);
  const bots = useMemo(() => state.bots.filter((bot) => !bot.hidden), [state.bots]);
  const sections = useMemo(() => buildTeamMapSections(bots, [
    ...(state.sections ?? []), ...state.groups.flatMap((group) => group.section ? [group.section] : []),
  ]), [bots, state.sections, state.groups]);
  const edges = useMemo(() => buildTeamMapEdges(bots, snapshot), [bots, snapshot]);

  const refresh = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      setSnapshot(await api("/api/team-map"));
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-app text-ink">
      <header className="flex shrink-0 items-center justify-between border-b border-hairline/40 px-7 py-5 max-md:pl-12">
        <div>
          <div className="flex items-center gap-2.5">
            <Network size={20} className="text-accent" />
            <h1 className="text-[18px] font-semibold">Team map</h1>
          </div>
          <p className="mt-1 text-[12.5px] text-ink-secondary">
            {t("team.organizationHint")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
        {!remoteClient && <button onClick={() => setTeamEditor({})} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-white"><Plus size={15} /> {t("team.create")}</button>}
        <button
          onClick={() => void refresh(true)}
          disabled={refreshing}
          className="rounded-lg border border-hairline/50 bg-card p-2 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-50"
          aria-label="Refresh team map"
          title="Refresh"
        >
          <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
        </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
        {error && <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>}

        <div className="space-y-4">
          {sections.map((section) => {
            const hasHierarchy = section.chiefs.length > 0 && section.members.length > 0;
            const empty = section.key && ![...state.bots, ...state.groups].some((record) => record.section?.trim() === section.key);
            return (
              <section key={section.key} className="@container/teammap rounded-2xl border border-hairline/50 bg-panel p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">{section.name}</h2>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {!remoteClient && section.key && <button onClick={() => setTeamEditor({ section: section.key })}
                      aria-label={t("team.moveTo", { name: section.name })} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] font-medium text-ink-secondary hover:bg-raised"><Users size={12} /> {t("team.move")}</button>}
                    {!remoteClient && <button
                      onClick={() => setContextEditor({ section: section.key, label: section.name })}
                      className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] font-medium text-ink-secondary hover:bg-raised hover:text-ink"
                      aria-label={t("team.instructionsEdit", { name: section.name })}
                      title={t("team.instructions")}
                    >
                      <BookOpen size={11} /> {t("team.instructions")}
                    </button>}
                    {!remoteClient && empty && <>
                      <button onClick={() => setTeamEditor({ section: section.key, rename: true })} aria-label={t("team.renameAria", { name: section.name })} title={t("team.renameEmpty")} className="rounded-md p-1 text-ink-secondary hover:bg-raised"><Pencil size={12} /></button>
                      <button onClick={() => setDeletingTeam(section.key)} aria-label={t("team.deleteAria", { name: section.name })} title={t("team.deleteEmpty")} className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-danger"><Trash2 size={12} /></button>
                    </>}
                    <span className="text-[11px] tabular-nums text-ink-secondary">{section.chiefs.length + section.members.length}</span>
                  </div>
                </div>
                {section.chiefs.length + section.members.length === 0 && <p className="py-2 text-[13px] text-ink-secondary">{t("team.empty")}</p>}
                <div
                  className={cn(
                    "grid gap-3",
                    hasHierarchy && "@min-[700px]/teammap:grid-cols-[minmax(220px,280px)_40px_minmax(0,1fr)]",
                  )}
                >
                  {section.chiefs.length > 0 && (
                    <div className="min-w-0">
                      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-secondary/75">Coordinator</div>
                      <div className="space-y-2">
                        {section.chiefs.map((bot) => (
                          <BotNode key={bot.id} bot={bot} chief onViewInstructions={setInstructionsBot} />
                        ))}
                      </div>
                    </div>
                  )}

                  {hasHierarchy && (
                    <div className="flex h-8 items-center justify-center text-ink-secondary/50 @min-[700px]/teammap:h-auto @min-[700px]/teammap:pt-5" aria-hidden="true">
                      <ArrowRight size={32} strokeWidth={1.5} className="shrink-0 rotate-90 @min-[700px]/teammap:rotate-0" />
                    </div>
                  )}

                  {section.members.length > 0 && (
                    <div className="min-w-0">
                      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-secondary/75">Team</div>
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-2">
                        {section.members.map((bot) => (
                          <BotNode key={bot.id} bot={bot} onViewInstructions={setInstructionsBot} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        {edges.length > 0 && (
          <section className="mt-6 max-w-[900px]">
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">Agent handoffs</h2>
              <span className="text-[11px] text-ink-secondary">Running and queued first</span>
            </div>
            <div className="space-y-2">
              {edges.slice(0, 12).map((edge) => (
                <EdgeRow key={`${edge.sourceBotId}:${edge.targetBotId}`} edge={edge} bots={bots} />
              ))}
            </div>
          </section>
        )}
      </div>
      {contextEditor && (
        <SectionContextDialog
          section={contextEditor.section}
          label={contextEditor.label}
          onClose={() => setContextEditor(null)}
        />
      )}
      {instructionsBot && <BotInstructionsDialog bot={instructionsBot} onClose={() => setInstructionsBot(null)} />}
      {teamEditor && <TeamDialog {...teamEditor} onClose={() => setTeamEditor(null)} />}
      <ConfirmDialog open={deletingTeam !== null} title={t("team.deleteTitle", { name: deletingTeam ?? "" })}
        body={t("team.deleteDescription")}
        confirmLabel={t("team.delete")} onCancel={() => setDeletingTeam(null)} onConfirm={() => {
          const name = deletingTeam;
          setDeletingTeam(null);
          if (!name) return;
          void api(`/api/sidebar-sections?section=${encodeURIComponent(name)}`, { method: "DELETE" })
            .then(({ sections: names }) => dispatch({ type: "sections", sections: names }))
            .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
        }} />
    </main>
  );
}
