import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { CloudSendBridge, CloudSendOutcome, CloudSendSnapshot } from "../../electron/cloud-send.mjs";
import { finalFailure, ipcErrorText, resultLines, sendStateLine, statusLine } from "@/lib/cloud-send";
import { activeLocale, t } from "@/lib/i18n";
import { localizedRelativeTime } from "@/lib/memory";
import { Card } from "./SettingsPrimitives";

const cleanError = (cause: unknown) => ipcErrorText(cause) ?? t("cloudSend.status.unreachable");

/** This computer's side of Send to My Cloud: main's snapshot, a fresh comparison on open, and the actions. */
export function useCloudSend(bridge: CloudSendBridge | undefined) {
  const [snapshot, setSnapshot] = useState<CloudSendSnapshot | null>(null);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CloudSendOutcome | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (!bridge) return;
    const unsubscribe = bridge.onState((next) => { if (alive.current) setSnapshot(next); });
    void bridge.state().then((next) => { if (alive.current) setSnapshot(next); }).catch(() => {});
    setComparing(true);
    void bridge.refresh().then((next) => { if (alive.current) setSnapshot(next); }).catch(() => {}).finally(() => { if (alive.current) setComparing(false); });
    return () => { alive.current = false; unsubscribe(); };
  }, [bridge]);
  const act = async (action: () => Promise<CloudSendSnapshot | CloudSendOutcome>) => {
    setError(null);
    try {
      const result = await action();
      if (!alive.current) return;
      if ("result" in result) setOutcome(result);
      else setSnapshot(result);
    } catch (cause) { if (alive.current) setError(cleanError(cause)); }
  };
  return {
    snapshot, comparing, error, outcome,
    refresh: () => { setComparing(true); void act(() => bridge!.refresh()).finally(() => setComparing(false)); },
    sendAll: () => act(() => bridge!.send()),
  };
}

/** Settings → MausBot Cloud, first: whether My Cloud is online, one plain line on where things stand (with one Try again
 * when something couldn't go), and Send everything. */
export function CloudSendCard() {
  const bridge = window.ogb?.remoteClient?.active ? undefined : window.ogb?.cloudSend;
  const send = useCloudSend(bridge);
  // One send per click: main shows it running only once its state arrives, and each send is one sign-in at My Cloud.
  const [sending, setSending] = useState(false);
  const { snapshot } = send;
  if (!bridge || !snapshot || snapshot.cloud === "none") return null;
  const ready = snapshot.cloud === "ready";
  const running = Boolean(snapshot.running) || sending;
  const status = statusLine(snapshot, send.comparing);
  // The newer of this page's own send and main's record: a send that failed as a whole is only in main's.
  const last = send.outcome && (!snapshot.last || send.outcome.at >= snapshot.last.at) ? send.outcome : snapshot.last;
  const shown = last ? resultLines(last) : null;
  const line = ready ? sendStateLine(snapshot, last) : null;
  const retry = line?.kind === "failed" && !finalFailure(last);
  const sendAll = () => { setSending(true); void send.sendAll().finally(() => setSending(false)); };
  return <Card title={t("cloudSend.title")} subtitle={t("cloudSend.intro")}>
    <div data-cloud-send={snapshot.cloud} data-running={running || undefined} className="flex flex-col gap-4">
      {status && <div className="flex flex-wrap items-center gap-2">
        <p role="status" className={status.tone === "status" ? "text-[13px] text-ink-secondary" : "text-[13px] text-ink"}>{status.text}</p>
        {!ready && !send.comparing && <button type="button" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent-text underline underline-offset-2 hover:text-ink" onClick={send.refresh}>
          <RefreshCw size={12} aria-hidden="true" />{t("cloudSend.check")}</button>}
      </div>}
      {line && <div data-cloud-send-state={line.kind} className="flex flex-col items-start gap-1">
        <p role={line.kind === "failed" ? "alert" : "status"} className={`inline-flex items-center gap-2 text-[13px] ${line.kind === "failed" ? "text-danger" : "text-ink"}`}>
          {line.kind === "sending" && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}{line.text}
        </p>
        {retry && <button type="button" data-cloud-send-retry disabled={running} className="text-[12.5px] font-medium text-accent-text underline underline-offset-2 hover:text-ink disabled:opacity-50"
          onClick={sendAll}>{t("cloudSend.strip.retry")}</button>}
        {line.kind !== "sending" && shown?.notes.map((note) => <p key={note} className="text-[12px] text-ink-secondary">{note}</p>)}
        {line.kind !== "sending" && last && <p className="text-[12px] text-ink-tertiary">{t("cloudSend.result.when", { when: localizedRelativeTime(last.at, activeLocale()) })}</p>}
        {send.error && send.error !== last?.error && <p role="alert" className="text-[13px] text-danger">{send.error}</p>}
      </div>}
      {ready && !retry && <button type="button" data-cloud-send-all className="ui-button ui-button-primary inline-flex items-center gap-2 self-start" disabled={running} onClick={sendAll}>
        {t("cloudSend.send")}
      </button>}
      <p className="text-[12px] leading-relaxed text-ink-secondary" data-cloud-send-separate>{t("cloudSend.separate")}</p>
    </div>
  </Card>;
}
