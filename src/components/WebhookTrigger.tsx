import { boatCapableEngine } from "@/lib/remote-desktop";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Cloud,
  Copy,
  ExternalLink,
  Laptop,
  Loader2,
  Pause,
  Play,
  RotateCw,
  Trash2,
  Webhook,
  X,
} from "lucide-react";

import { BotAvatar } from "@/components/Avatar";
import { cn } from "@/lib/cn";
import type { RoutineRun, RoutineRunOn } from "@/lib/routines";
import {
  loadWebhookCredentials,
  removeWebhookCredential,
  saveWebhookCredential,
  webhookCredentialStore,
} from "@/lib/webhook-credentials";
import { WEBHOOK_DEFAULT_MAX_PENDING_RUNS, WEBHOOK_MAX_PENDING_RUNS_LIMIT, webhookActivationDefaults, webhookMaxPendingRunsInput, type WebhookAttempt, type WebhookCredential, type WebhookTrigger, type WebhookTriggerInput } from "@/lib/webhooks";
import { api, openBotThread, useStore, type Bot } from "@/state/store";
import { useShowThreads } from "@/lib/thread-preferences";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { Switch } from "./SettingsPrimitives";

export function relativeTime(at?: number) {
  if (!at) return "Never";
  const elapsed = Math.max(0, Date.now() - at);
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
}

function deliverySummary(run: RoutineRun) {
  const eventName = run.prompt?.match(/^Event: (.+)$/m)?.[1]?.trim() || "Webhook event";
  const eventData = run.prompt?.match(/\[UNTRUSTED WEBHOOK EVENT DATA\]\n([\s\S]*?)\n\[\/UNTRUSTED WEBHOOK EVENT DATA\]/)?.[1] ?? "";
  const payloadStart = eventData.indexOf("\n\n");
  const payload = (payloadStart >= 0 ? eventData.slice(payloadStart + 2) : eventData).replace(/\s+/g, " ").trim();
  return { eventName, preview: payload.slice(0, 240) };
}

export function suggestedName(prompt: string, bot?: Bot) {
  const first = prompt.trim().split(/[.!?\n]/)[0]?.trim().slice(0, 60);
  return first || `${bot?.name ?? "Bot"} webhook`;
}

export function statusFor(webhook: WebhookTrigger) {
  if (webhook.verificationPending) return { label: "Waiting for test", tone: "text-accent", dot: "bg-accent animate-pulse" };
  if (webhook.verifiedAt && !webhook.enabled) return { label: "Ready to enable", tone: "text-warning", dot: "bg-warning" };
  if (webhook.enabled) return { label: "Active", tone: "text-success", dot: "bg-success" };
  return { label: "Paused", tone: "text-ink-secondary", dot: "bg-ink-secondary/50" };
}

export function outcomeTone(outcome: WebhookAttempt["outcome"], run?: RoutineRun) {
  if (outcome === "rejected" || run?.status === "failed" || run?.status === "missed") return "text-danger";
  if (run && ["queued", "running", "waiting"].includes(run.status)) return "text-accent";
  if (run?.status === "completed" || outcome === "captured" || outcome === "accepted") return "text-success";
  return "text-ink-secondary";
}

export function outcomeLabel(outcome: WebhookAttempt["outcome"], run?: RoutineRun) {
  if (run) return run.status === "waiting" ? "Needs you" : run.status[0]!.toUpperCase() + run.status.slice(1);
  if (outcome === "captured") return "Test received";
  if (outcome === "duplicate") return "Duplicate";
  if (outcome === "ignored") return "Ignored";
  if (outcome === "rejected") return "Rejected";
  return "Accepted";
}

export function terminalCommand(credential: WebhookCredential) {
  return `curl -sS '${credential.url}' --json '{"task":"A customer wrote: This app saved me hours. Write a short thank-you reply."}'`;
}

export function WebhookEditor({ webhook, bots, onClose, onCredential }: { webhook?: WebhookTrigger; bots: Bot[]; onClose: () => void; onCredential: (credential: WebhookCredential, webhookId: string) => void }) {
  const { state, dispatch } = useStore();
  const [botId, setBotId] = useState(webhook?.botId ?? bots[0]?.id ?? "");
  const [name, setName] = useState(webhook?.name ?? "");
  const [prompt, setPrompt] = useState(webhook?.prompt ?? "");
  const [runOn, setRunOn] = useState<RoutineRunOn>(webhook?.runOn ?? "maus");
  const [eventTypes, setEventTypes] = useState((webhook?.eventTypes ?? []).join(", "));
  const [maxPendingRuns, setMaxPendingRuns] = useState(webhook?.maxPendingRuns?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const cloudReady = Boolean(state.config?.box.configured && boatCapableEngine(state.instances, bots.find(bot => bot.id === botId)?.modelSelection.instanceId)?.snapshot.state === "available");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hasAttribute("hidden"));
    (dialog.querySelector<HTMLElement>("[data-initial-focus]") ?? focusable()[0] ?? dialog).focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (!controls.length) return event.preventDefault();
      const first = controls[0]!;
      const last = controls[controls.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", onKey);
    return () => {
      dialog.removeEventListener("keydown", onKey);
      if (previousFocus?.getClientRects().length) previousFocus.focus();
      else document.querySelector<HTMLElement>('summary[aria-label="Create an automation"]')?.focus();
    };
  }, []);

  const save = async () => {
    const bot = bots.find((candidate) => candidate.id === botId);
    const pendingLimit = webhookMaxPendingRunsInput(maxPendingRuns);
    if (pendingLimit === undefined) {
      setError(`Unfinished tasks at once must be a whole number from 1 to ${WEBHOOK_MAX_PENDING_RUNS_LIMIT}.`);
      return;
    }
    const input: WebhookTriggerInput = { name: name.trim() || suggestedName(prompt, bot), prompt: prompt.trim(), botId, runOn, ...webhookActivationDefaults(webhook), eventTypes: eventTypes.split(",").map((value) => value.trim()).filter(Boolean), maxPendingRuns: pendingLimit };
    setSaving(true);
    setError("");
    try {
      const response = await api(webhook ? `/api/webhooks/${webhook.id}` : "/api/webhooks", { method: webhook ? "PATCH" : "POST", body: JSON.stringify(input) });
      dispatch({ type: "webhookPatched", webhook: response.webhook });
      onClose();
      if (response.credential) onCredential(response.credential, response.webhook.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={webhook ? "Edit webhook trigger" : "New webhook trigger"} tabIndex={-1} className="flex max-h-[90vh] w-full max-w-[590px] flex-col overflow-hidden rounded-2xl border border-hairline/60 bg-panel shadow-2xl">
        <div className="flex items-start justify-between border-b border-hairline/40 px-5 py-4"><div><div className="text-[17px] font-semibold text-ink">{webhook ? "Edit webhook trigger" : "When another app calls a link"}</div><div className="mt-1 text-[12px] text-ink-secondary">Each call starts a task for the bot.</div></div><button onClick={onClose} aria-label="Close webhook editor" className="rounded-lg p-2 text-ink-secondary hover:bg-raised hover:text-ink"><X size={18} /></button></div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <div><div className="mb-2 text-[12px] font-medium text-ink-secondary">Who receives the tasks?</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{bots.map((bot) => <button key={bot.id} type="button" data-initial-focus={botId === bot.id ? "" : undefined} onClick={() => setBotId(bot.id)} className={cn("flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left", botId === bot.id ? "border-accent/70 bg-accent/10" : "border-hairline/50 bg-inset hover:bg-raised/60")}><BotAvatar bot={bot} state={botId === bot.id ? "happy" : "idle"} size={38} animated={false} /><span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{bot.name}</span></button>)}</div></div>
          <div className="rounded-xl border border-accent/20 bg-accent/5 px-3.5 py-3 text-[11.5px] leading-relaxed text-ink-secondary">Send the task in the request: <code className="text-ink">{`{"task":"Check the failed build"}`}</code>. The bot keeps its model, tools, permissions, and computer setup.</div>
          <details className="group rounded-xl border border-hairline/45 bg-inset/45 px-4 py-3" open={Boolean(webhook)}>
            <summary className="cursor-pointer text-[12.5px] font-medium text-ink">Advanced options</summary>
            <div className="mt-4 space-y-4">
              <label className="block"><span className="mb-1.5 block text-[11.5px] font-medium text-ink-secondary">Name <span className="font-normal">· optional</span></span><input value={name} onChange={(event) => setName(event.target.value)} placeholder={suggestedName(prompt, bots.find((bot) => bot.id === botId))} className="w-full rounded-xl border border-hairline/60 bg-panel px-3.5 py-2.5 text-[13px] text-ink outline-none placeholder:text-ink-tertiary focus:border-accent/70" /></label>
              <label className="block"><span className="mb-1.5 block text-[11.5px] font-medium text-ink-secondary">Default instructions <span className="font-normal">· optional</span></span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} placeholder="For every event, summarize what happened and suggest the next step…" className="w-full resize-y rounded-xl border border-hairline/60 bg-panel px-3.5 py-3 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-tertiary focus:border-accent/70" /><span className="mt-1.5 block text-[10.5px] leading-relaxed text-ink-secondary">Use this only when every event needs the same handling rule. Otherwise the request’s task is used.</span></label>
              <div><div className="mb-2 text-[11.5px] font-medium text-ink-secondary">Run on</div><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setRunOn("maus")} className={cn("rounded-xl border p-3 text-left", runOn === "maus" ? "border-accent/70 bg-accent/10" : "border-hairline/50 bg-panel hover:bg-raised/60")}><div className="flex items-center gap-2 text-[12.5px] font-medium text-ink"><Laptop size={14} />This computer</div></button><button type="button" disabled={!cloudReady && runOn !== "cloud"} onClick={() => setRunOn("cloud")} className={cn("rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-45", runOn === "cloud" ? "border-accent/70 bg-accent/10" : "border-hairline/50 bg-panel hover:bg-raised/60")}><div className="flex items-center gap-2 text-[12.5px] font-medium text-ink"><Cloud size={14} />Cloud computer</div></button></div></div>
              <label className="block"><span className="mb-1.5 block text-[11.5px] font-medium text-ink-secondary">Only accept event types <span className="font-normal">· optional</span></span><input value={eventTypes} onChange={(event) => setEventTypes(event.target.value)} placeholder="push, workflow_run" className="w-full rounded-xl border border-hairline/60 bg-panel px-3.5 py-2.5 text-[13px] text-ink outline-none placeholder:text-ink-tertiary focus:border-accent/70" /><span className="mt-1.5 block text-[10.5px] text-ink-secondary">Comma-separated values from the sender’s event-type header.</span></label>
              <label className="block"><span className="mb-1.5 block text-[11.5px] font-medium text-ink-secondary">Unfinished tasks at once <span className="font-normal">· optional</span></span><input type="number" inputMode="numeric" min={1} max={WEBHOOK_MAX_PENDING_RUNS_LIMIT} step={1} value={maxPendingRuns} onChange={(event) => setMaxPendingRuns(event.target.value)} placeholder={String(WEBHOOK_DEFAULT_MAX_PENDING_RUNS)} className="w-full rounded-xl border border-hairline/60 bg-panel px-3.5 py-2.5 text-[13px] text-ink outline-none placeholder:text-ink-tertiary focus:border-accent/70" /><span className="mt-1.5 block text-[10.5px] text-ink-secondary">How many of this webhook’s tasks can be queued or running together. More requests get HTTP 429 until one finishes. Leave blank for {WEBHOOK_DEFAULT_MAX_PENDING_RUNS}.</span></label>
            </div>
          </details>
          {error && <div className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-[12px] text-danger">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-hairline/40 px-5 py-4"><button onClick={onClose} className="rounded-xl px-4 py-2 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink">Cancel</button><button disabled={saving || !botId} onClick={() => void save()} className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-40">{saving && <Loader2 size={14} className="animate-spin" />}{webhook ? "Save changes" : "Create trigger"}</button></div>
      </div>
    </div>
  );
}

export interface ActivityItem { id: string; at: number; outcome: WebhookAttempt["outcome"]; eventName: string; preview: string; reason?: string; run?: RoutineRun }

export function webhookActivity(webhook: WebhookTrigger, webhookAttempts: WebhookAttempt[], routineRuns: RoutineRun[]): ActivityItem[] {
  const runById = new Map(routineRuns.map((run) => [run.id, run]));
  const attemptsByRun = new Set(webhookAttempts.map((attempt) => attempt.runId).filter(Boolean));
  const attempts = webhookAttempts
    .filter((attempt) => attempt.webhookId === webhook.id)
    .map((attempt) => ({
      id: attempt.id,
      at: attempt.receivedAt,
      outcome: attempt.outcome,
      eventName: attempt.eventName || (attempt.outcome === "rejected" ? "Rejected request" : "Webhook event"),
      preview: attempt.preview || "",
      reason: attempt.reason,
      run: attempt.runId ? runById.get(attempt.runId) : undefined,
    }));
  const legacy = routineRuns
    .filter((run) => run.webhookId === webhook.id && !attemptsByRun.has(run.id))
    .map((run) => {
      const summary = deliverySummary(run);
      return { id: run.id, at: run.scheduledFor, outcome: "accepted" as const, eventName: summary.eventName, preview: summary.preview, run };
    });
  return [...attempts, ...legacy].sort((a, b) => b.at - a.at).slice(0, 30);
}

export function useWebhookActions() {
  const { dispatch } = useStore();
  const [credentials, setCredentials] = useState<Record<string, WebhookCredential>>(() =>
    loadWebhookCredentials(webhookCredentialStore()),
  );
  const [working, setWorking] = useState<string | null>(null);
  // A second click can arrive before React paints the disabled state: claim synchronously so rotations cannot race and
  // save a revoked URL.
  const workingRef = useRef(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedKind, setCopiedKind] = useState<"command" | "link">("command");
  const [error, setError] = useState("");

  const invoke = async (webhook: WebhookTrigger, action: "toggle" | "delete") => {
    if (workingRef.current) return;
    workingRef.current = true;
    setWorking(`${webhook.id}:${action}`);
    setError("");
    try {
      if (action === "delete") {
        if (!window.confirm(`Delete “${webhook.name}”? Existing thread history will stay available.`)) return;
        await api(`/api/webhooks/${webhook.id}`, { method: "DELETE" });
        dispatch({ type: "webhookDeleted", webhookId: webhook.id });
        removeWebhookCredential(webhookCredentialStore(), webhook.id);
        setCredentials((current) => {
          const next = { ...current };
          delete next[webhook.id];
          return next;
        });
      } else {
        const enabling = !webhook.enabled;
        if (enabling && webhook.verificationPending) throw new Error("Send a request before turning this webhook on");
        const response = await api(`/api/webhooks/${webhook.id}`, { method: "PATCH", body: JSON.stringify({ enabled: enabling, verificationPending: false }) });
        dispatch({ type: "webhookPatched", webhook: response.webhook });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      workingRef.current = false;
      setWorking(null);
    }
  };

  const createAndCopyCommand = async (webhook: WebhookTrigger, replace = false, copy: "command" | "link" = "command") => {
    if (workingRef.current) return;
    workingRef.current = true;
    setWorking(`${webhook.id}:command`);
    setError("");
    try {
      if (replace && !window.confirm("Replace this private URL? Every previously copied command will stop working.")) return;
      let credential = replace ? undefined : credentials[webhook.id];
      if (!credential) {
        const response = await api(`/api/webhooks/${webhook.id}/rotate`, { method: "POST" });
        credential = response.credential;
        dispatch({ type: "webhookPatched", webhook: response.webhook });
        setCredentials((current) => ({ ...current, [webhook.id]: credential! }));
        saveWebhookCredential(webhookCredentialStore(), webhook.id, credential!);
      }
      if (!credential) throw new Error("Could not create a terminal command");
      if (await copyText(copy === "link" ? credential.url : terminalCommand(credential)) !== "copied") throw new Error(t("common.copyFailed"));
      setCopiedId(webhook.id);
      setCopiedKind(copy);
      setTimeout(() => setCopiedId((current) => current === webhook.id ? null : current), 1_800);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      workingRef.current = false;
      setWorking(null);
    }
  };

  const rememberCredential = (webhookId: string, credential: WebhookCredential) => {
    saveWebhookCredential(webhookCredentialStore(), webhookId, credential);
    setCredentials((current) => ({ ...current, [webhookId]: credential }));
  };

  return { credentials, setCredentials, rememberCredential, working, copiedId, copiedKind, error, setError, invoke, createAndCopyCommand };
}

/** The webhook triggers in the Triggers page's list: one row each, opening its drawer. */
export function WebhookTriggerList({ webhooks, bots, selectedId, onOpen }: { webhooks: WebhookTrigger[]; bots: Bot[]; selectedId?: string; onOpen: (webhook: WebhookTrigger) => void }) {
  const { state, dispatch } = useStore();
  const [working, setWorking] = useState<string | null>(null);
  const toggle = async (webhook: WebhookTrigger) => {
    setWorking(webhook.id);
    try {
      const response = await api(`/api/webhooks/${webhook.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !webhook.enabled, verificationPending: false }) });
      dispatch({ type: "webhookPatched", webhook: response.webhook });
    } finally {
      setWorking(null);
    }
  };
  return (
    <div className="space-y-3" aria-label="Webhook triggers">
      {webhooks.map((webhook) => {
        const bot = bots.find((candidate) => candidate.id === webhook.botId);
        const latest = state.routineRuns.filter((run) => run.webhookId === webhook.id).sort((a, b) => b.scheduledFor - a.scheduledFor)[0];
        return (
          <article key={webhook.id} aria-label={webhook.name} className={cn("rounded-xl border bg-card p-3.5", selectedId === webhook.id ? "border-accent/60" : "border-hairline/40")}>
            <div className="flex items-start gap-2">
              <button type="button" onClick={() => onOpen(webhook)} className="flex min-w-0 flex-1 items-start gap-2.5 text-left hover:text-accent">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><Webhook size={14} /></span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-ink">{webhook.name}</span>
                  <span className="mt-1 block text-[11.5px] leading-relaxed text-ink-secondary">{bot ? `${bot.name} · ` : ""}When its link is called{webhook.eventTypes?.length ? ` (${webhook.eventTypes.join(", ")})` : ""}</span>
                </span>
              </button>
              <Switch checked={webhook.enabled} disabled={working === webhook.id} aria-label={`Turn ${webhook.name} ${webhook.enabled ? "off" : "on"}`} onClick={() => void toggle(webhook)} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-[11.5px]">
              {latest
                ? <span className={outcomeTone("accepted", latest)}>Last call {relativeTime(latest.scheduledFor)} · {outcomeLabel("accepted", latest)}</span>
                : <span className="text-ink-secondary">{webhook.deliveryCount > 0 ? `${webhook.deliveryCount} received · last ${relativeTime(webhook.lastReceivedAt)}` : "Waiting for the first call"}</span>}
            </div>
          </article>
        );
      })}
    </div>
  );
}

/** One webhook trigger's drawer on the Triggers page: its link, settings and recent calls. */
export function WebhookDetails({ webhook, bots, onClose, onEdit }: { webhook: WebhookTrigger; bots: Bot[]; onClose: () => void; onEdit: () => void }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const { credentials, working, copiedId, copiedKind, error, invoke, createAndCopyCommand } = useWebhookActions();
  const bot = bots.find((candidate) => candidate.id === webhook.botId);
  const activity = useMemo<ActivityItem[]>(() => webhookActivity(webhook, state.webhookAttempts, state.routineRuns), [webhook, state.routineRuns, state.webhookAttempts]);
  const ingress = state.webhookIngress;
  const credential = credentials[webhook.id];
  const status = statusFor(webhook);
  return (
    <aside aria-label="Webhook trigger" className="flex h-full w-[min(340px,100vw)] shrink-0 flex-col border-l border-hairline/40 bg-panel">
      <div className="flex items-start gap-3 border-b border-hairline/40 px-4 py-3.5">
        {bot ? <BotAvatar bot={bot} state={webhook.enabled ? "idle" : "sleeping"} size={36} animated={false} label={bot.name} /> : <span className="flex size-9 items-center justify-center rounded-xl bg-raised text-ink-secondary"><Webhook size={16} /></span>}
        <div className="min-w-0 flex-1">
          <div className="break-words text-[15px] font-semibold leading-snug text-ink">{webhook.name}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[10.5px]"><span className={cn("size-1.5 rounded-full", status.dot)} /><span className={status.tone}>{status.label}</span><span className="text-ink-secondary">· {bot?.name ?? "Deleted bot"}</span></div>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1.5 text-ink-secondary hover:bg-raised hover:text-ink" aria-label="Close"><X size={16} /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-[12px]">
        {error && <div role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[11.5px] text-danger">{error}</div>}
        {ingress && !ingress.available && <div className="rounded-lg bg-danger/10 px-3 py-2 text-[11.5px] text-danger">Webhook receiver unavailable{ingress.error ? `: ${ingress.error}` : "."}</div>}
        <section>
          <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-tertiary">When</h3>
          <p className="text-[12.5px] text-ink">Another app calls this trigger&apos;s private link{webhook.eventTypes?.length ? ` with event ${webhook.eventTypes.join(", ")}` : ""}.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" disabled={Boolean(working) || !ingress?.available} onClick={() => void createAndCopyCommand(webhook, false, "link")} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11.5px] font-medium text-white hover:brightness-110 disabled:opacity-40">{copiedId === webhook.id && copiedKind === "link" ? <Check size={12} /> : <Copy size={12} />}{copiedId === webhook.id && copiedKind === "link" ? "Copied" : "Copy link"}</button>
            <button type="button" disabled={Boolean(working) || !ingress?.available} onClick={() => void createAndCopyCommand(webhook)} className="flex items-center gap-1.5 rounded-lg border border-hairline/50 px-3 py-1.5 text-[11.5px] text-ink hover:bg-raised disabled:opacity-40">{copiedId === webhook.id && copiedKind === "command" ? <Check size={12} /> : <Copy size={12} />}Copy as curl</button>
            {credential && <button type="button" disabled={Boolean(working)} onClick={() => void createAndCopyCommand(webhook, true, "link")} title="Replace the private link" className="rounded-lg p-1.5 text-ink-secondary hover:bg-raised hover:text-ink"><RotateCw size={12} /></button>}
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink-secondary">{credential ? "Callers can also send the secret as Authorization: Bearer instead of in the link." : "The link is made when you first copy it, and shown once; copying again later makes a new one."} Keep OpenMausBot open to receive calls.</p>
        </section>
        <section>
          <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-tertiary">Then</h3>
          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink">{bot?.name ?? "The bot"} {webhook.prompt ? `follows: ${webhook.prompt}` : "does the task each call sends."}</p>
          <p className="mt-1 text-[11px] text-ink-secondary">Runs on {webhook.runOn === "cloud" ? "the cloud computer" : "the bot's current setup"} · at most {webhook.maxPendingRuns ?? WEBHOOK_DEFAULT_MAX_PENDING_RUNS} unfinished at once</p>
        </section>
        <section>
          <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-tertiary">Recent calls</h3>
          {activity.length === 0 ? <p className="text-ink-secondary">No calls yet.</p> : activity.slice(0, 12).map((item) => (
            <div key={item.id} className="flex items-center gap-2 border-b border-hairline/25 py-2">
              <div className="min-w-0 flex-1"><div className="truncate font-medium text-ink">{item.eventName} <span className="font-normal text-ink-secondary">· {relativeTime(item.at)}</span></div><div className="truncate font-mono text-[10px] text-ink-tertiary">{item.reason || item.preview || "Empty payload"}</div></div>
              <span className={cn("shrink-0 text-[10px] font-medium", outcomeTone(item.outcome, item.run))}>{outcomeLabel(item.outcome, item.run)}</span>
              {item.run?.threadId && bot && <button type="button" onClick={() => openBotThread(dispatch, bot, item.run!.threadId!, showThreads)} title="Open this run" className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"><ExternalLink size={11} /></button>}
            </div>
          ))}
        </section>
      </div>
      <div className="flex items-center gap-2 border-t border-hairline/40 px-4 py-3">
        <button type="button" disabled={Boolean(working)} onClick={() => void invoke(webhook, "toggle")} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-hairline/50 bg-control px-3 py-2 text-[12px] font-medium text-ink hover:bg-raised-hover disabled:opacity-40">{webhook.enabled ? <Pause size={13} /> : <Play size={13} />}{webhook.enabled ? "Pause" : "Resume"}</button>
        <button type="button" onClick={onEdit} className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-ink hover:bg-raised">Edit</button>
        <button type="button" onClick={() => { void invoke(webhook, "delete"); }} className="rounded-lg p-2 text-ink-secondary hover:bg-danger/10 hover:text-danger" title="Delete" aria-label="Delete"><Trash2 size={14} /></button>
      </div>
    </aside>
  );
}
