import { lazy, Suspense, useState } from "react";
import { CalendarClock, Check, Copy, ExternalLink, Pause, Pencil, Play, Undo2, Webhook, Zap } from "lucide-react";

import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { routineRunLabel, routineRunTone } from "@/lib/routine-display";
import { useShowThreads } from "@/lib/thread-preferences";
import { cardTrigger, fireSummary, triggerView } from "@/lib/triggers";
import { loadWebhookCredentials, saveWebhookCredential, webhookCredentialStore } from "@/lib/webhook-credentials";
import { niceTime } from "@/lib/schedule-label";
import type { WebhookCredential } from "@/lib/webhooks";
import { api, ApiError, openBotThread, useStore, type OptionCardData } from "@/state/store";

// The editors live with the Triggers page; a chat only loads one when Edit is pressed.
const RoutineEditor = lazy(async () => ({ default: (await import("./RoutinesPage")).RoutineEditor }));
const WebhookEditor = lazy(async () => ({ default: (await import("./WebhookTrigger")).WebhookEditor }));

const ACTION = "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium hover:bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50";

/** The live card a trigger made in chat leaves in the conversation: what fires it, who does what, and what happened last. */
export function TriggerCard({ card, threadId }: { card: OptionCardData; threadId?: string }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"undo" | "pause" | "copy" | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const ref = cardTrigger(card);
  if (!ref) return null;
  const view = triggerView(ref, { routines: state.routines, webhooks: state.webhooks, runs: state.routineRuns });
  const routine = ref.kind === "schedule" ? state.routines.find((candidate) => candidate.id === ref.id) : undefined;
  const webhook = ref.kind === "webhook" ? state.webhooks.find((candidate) => candidate.id === ref.id) : undefined;
  const name = view?.name ?? card.routineRequest?.undo?.name ?? card.webhookRequest?.undo?.name ?? card.title;

  if (card.undone || !view) {
    const loading = !card.undone && (ref.kind === "schedule" ? state.routinesLoadState === "loading" : false);
    if (loading) return null;
    return (
      <div data-trigger-card={ref.id} className="flex w-full max-w-[840px] items-center gap-2 text-[12.5px] text-ink-tertiary">
        {card.undone ? <Undo2 size={13} /> : <Zap size={13} />}
        <span>{card.undone ? `Trigger “${name}” removed · undone` : `Trigger “${name}” no longer exists`}</span>
      </div>
    );
  }

  const bot = state.bots.find((candidate) => candidate.id === view.botId);
  const last = view.lastFire;
  const undo = () => {
    if (!threadId || !card.requestId || busy) return;
    setBusy("undo");
    setError(undefined);
    api(`/api/threads/${threadId}/undo`, { method: "POST", body: JSON.stringify({ requestId: card.requestId }) })
      .catch((failure: unknown) => setError(failure instanceof ApiError && failure.body?.code === "changed-since"
        ? "It changed since, so it can't be undone here. Change it on the Triggers page."
        : `Couldn't undo: ${failure instanceof Error ? failure.message : String(failure)}`))
      .finally(() => setBusy(null));
  };
  const togglePause = () => {
    if (busy) return;
    setError(undefined);
    if (routine) return dispatch({ type: "updateRoutine", routineId: routine.id, patch: { enabled: !routine.enabled } });
    if (!webhook) return;
    setBusy("pause");
    api(`/api/webhooks/${webhook.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !webhook.enabled, verificationPending: false }) })
      .then((response) => dispatch({ type: "webhookPatched", webhook: response.webhook }))
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
      .finally(() => setBusy(null));
  };
  const copyLink = async () => {
    if (!webhook || busy) return;
    setBusy("copy");
    setError(undefined);
    try {
      let credential: WebhookCredential | undefined = loadWebhookCredentials(webhookCredentialStore())[webhook.id];
      if (!credential) {
        // A bot-made webhook has no usable secret until the person asks for its link: this mints it, once.
        const response = await api(`/api/webhooks/${webhook.id}/rotate`, { method: "POST" });
        credential = response.credential as WebhookCredential;
        dispatch({ type: "webhookPatched", webhook: response.webhook });
        saveWebhookCredential(webhookCredentialStore(), webhook.id, credential);
      }
      if (await copyText(credential.url) !== "copied") throw new Error("Couldn't copy the link");
      setCopied(true);
      setTimeout(() => setCopied(false), 1_800);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(null);
    }
  };
  const status = !view.enabled ? "Paused" : last ? undefined : view.next ?? "Waiting for its first run";
  const visibleBots = state.bots.filter((candidate) => !candidate.hidden);

  return (
    <section
      data-trigger-card={view.id}
      aria-label={`Trigger: ${view.name}`}
      className={cn("w-full max-w-[640px] rounded-2xl border bg-card px-4 py-3.5", view.enabled ? "border-accent/35" : "border-hairline/40")}
    >
      <div className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wider text-ink-tertiary">
        <Zap size={13} className={view.enabled ? "text-accent" : undefined} />
        <span>{view.enabled ? "Trigger on" : "Trigger paused"}</span>
        <button type="button" onClick={() => dispatch({ type: "showRoutines", view: "list", routineId: view.id })} className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium normal-case tracking-normal text-accent-text hover:bg-inset">Open in Triggers<ExternalLink size={11} /></button>
      </div>
      <div className="mt-2 flex items-start gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">{view.kind === "schedule" ? <CalendarClock size={14} /> : <Webhook size={14} />}</span>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-ink">{view.name}</div>
          <div className="mt-0.5 text-[12.5px] text-ink-secondary">{view.when}</div>
          <div className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-ink">
            <span className="font-medium">→ {bot?.name ?? "A bot"}</span> {view.instructions ? view.instructions : "does the task each call sends"}
          </div>
        </div>
      </div>
      <div className="mt-2.5 min-h-5 text-[12.5px]" aria-live="polite">
        {last ? (
          <>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className="text-ink-secondary">Last fired {niceTime(last.startedAt ?? last.scheduledFor)} ·</span>
              <span className={routineRunTone(last)}>{last.status === "waiting" ? "Needs your input" : routineRunLabel(last)}</span>
              {last.threadId && bot && <button type="button" onClick={() => openBotThread(dispatch, bot, last.threadId!, showThreads)} className="rounded-md px-1 font-medium text-accent-text hover:bg-inset">Open</button>}
              {view.firesToday > 1 && <span className="text-ink-tertiary">· {view.firesToday} today</span>}
              {view.enabled && view.next && <span className="text-ink-tertiary">· {view.next}</span>}
            </div>
            {fireSummary(last) && <p className="mt-0.5 line-clamp-2 text-ink-secondary">{fireSummary(last)}</p>}
          </>
        ) : <span className="text-ink-secondary">{status}</span>}
      </div>
      {error && <div role="alert" className="mt-1.5 text-[12px] text-warning">{error}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-hairline/30 pt-2">
        <button type="button" onClick={() => setEditing(true)} className={cn(ACTION, "text-ink")}><Pencil size={13} />Edit</button>
        <button type="button" onClick={togglePause} disabled={busy === "pause"} className={cn(ACTION, "text-ink")}>{view.enabled ? <Pause size={13} /> : <Play size={13} />}{view.enabled ? "Pause" : "Resume"}</button>
        {webhook && <button type="button" onClick={() => void copyLink()} disabled={busy === "copy"} className={cn(ACTION, "text-ink")}>{copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}{copied ? "Copied" : "Copy link"}</button>}
        {threadId && card.requestId && <button type="button" onClick={undo} disabled={busy === "undo"} className={cn(ACTION, "text-accent")}><Undo2 size={13} />{busy === "undo" ? "Undoing…" : "Undo"}</button>}
      </div>
      {editing && (
        <Suspense fallback={null}>
          {routine && <RoutineEditor routine={routine} bots={visibleBots} onClose={() => setEditing(false)} />}
          {webhook && <WebhookEditor webhook={webhook} bots={visibleBots} onClose={() => setEditing(false)} onCredential={(credential, id) => saveWebhookCredential(webhookCredentialStore(), id, credential)} />}
        </Suspense>
      )}
    </section>
  );
}
