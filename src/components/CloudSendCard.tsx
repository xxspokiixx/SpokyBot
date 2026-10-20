import { useEffect, useRef, useState } from "react";
import { ChevronRight, Cloud, Laptop, Loader2, RefreshCw } from "lucide-react";
import type { CloudSendBridge, CloudSendOutcome, CloudSendSnapshot } from "../../electron/cloud-send.mjs";
import type { LocaleKey } from "@/locales";
import { finalFailure, ipcErrorText, resultLines, sendStateLine, sideLines, statusLine, type SideKind } from "@/lib/cloud-send";
import { activeLocale, t } from "@/lib/i18n";
import { localizedRelativeTime } from "@/lib/memory";
import { Card, Switch } from "./SettingsPrimitives";

const KIND_LABEL: Record<SideKind, LocaleKey> = {
  bots: "cloudSend.kind.bots", skills: "cloudSend.kind.skills", logins: "cloudSend.kind.logins", settings: "cloudSend.kind.settings",
};

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
    useMine: (key: string) => act(() => bridge!.send({ keys: [key], force: [key] })),
    setAuto: (on: boolean) => act(() => bridge!.setAuto(on)),
    setItem: (key: string, on: boolean) => act(() => bridge!.setItem(key, on)),
  };
}

function SideBySide({ snapshot }: { snapshot: CloudSendSnapshot }) {
  const lines = sideLines(snapshot);
  return <table data-cloud-send-sides className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
    <thead>
      <tr className="text-left text-[12px] text-ink-secondary">
        <th scope="col" className="w-[22%] pb-2 font-normal"><span className="sr-only">{t("cloudSend.details")}</span></th>
        <th scope="col" className="w-[19%] pb-2 font-medium"><span className="inline-flex items-center gap-1.5"><Laptop size={13} aria-hidden="true" />{t("cloudSend.colHere")}</span></th>
        <th scope="col" className="w-[19%] pb-2 font-medium"><span className="inline-flex items-center gap-1.5"><Cloud size={13} aria-hidden="true" />{t("cloudSend.colCloud")}</span></th>
        <th scope="col" className="pb-2 font-normal"><span className="sr-only">{t("cloudSend.diff.same")}</span></th>
      </tr>
    </thead>
    <tbody>
      {lines.map((line) => <tr key={line.kind} data-cloud-send-kind={line.kind} data-waiting={line.waiting || undefined}>
        <th scope="row" className="border-t border-hairline/30 py-2 pe-2 text-left font-medium text-ink">{t(KIND_LABEL[line.kind])}</th>
        <td className="border-t border-hairline/30 py-2 pe-2 tabular-nums text-ink">{line.kind === "settings" ? t("cloudSend.settingsCount") : line.here}</td>
        <td className="border-t border-hairline/30 py-2 pe-2 tabular-nums text-ink">{line.kind === "settings" ? t("cloudSend.settingsCount") : line.cloud}</td>
        <td className={`border-t border-hairline/30 py-2 text-[12.5px] ${line.waiting ? "font-medium text-accent-text" : "text-ink-secondary"}`}>{line.difference}</td>
      </tr>)}
    </tbody>
  </table>;
}

/** Settings → MausBot Cloud, first: whether My Cloud is online, one plain line on where things stand (with one Try again
 * when something couldn't go), and Keep My Cloud up to date. Sending happens by itself; the comparison and a manual send
 * sit under More. */
export function CloudSendCard() {
  const bridge = window.ogb?.remoteClient?.active ? undefined : window.ogb?.cloudSend;
  const send = useCloudSend(bridge);
  const [more, setMore] = useState(false);
  // One send per click: main shows it running only once its state arrives, and each send is one sign-in at My Cloud.
  const [retrying, setRetrying] = useState(false);
  const { snapshot } = send;
  if (!bridge || !snapshot || snapshot.cloud === "none") return null;
  const ready = snapshot.cloud === "ready";
  const running = Boolean(snapshot.running);
  const status = statusLine(snapshot, send.comparing);
  // The newer of this page's own send and main's record: a send that failed as a whole is only in main's.
  const last = send.outcome && (!snapshot.last || send.outcome.at >= snapshot.last.at) ? send.outcome : snapshot.last;
  const shown = last ? resultLines(last) : null;
  const line = ready ? sendStateLine(snapshot, last) : null;
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
        {line.kind === "failed" && !finalFailure(last) && <button type="button" data-cloud-send-retry disabled={retrying} className="text-[12.5px] font-medium text-accent-text underline underline-offset-2 hover:text-ink disabled:opacity-50"
          onClick={() => { setRetrying(true); void send.sendAll().finally(() => setRetrying(false)); }}>{t("cloudSend.strip.retry")}</button>}
        {line.kind !== "sending" && shown?.notes.map((note) => <p key={note} className="text-[12px] text-ink-secondary">{note}</p>)}
        {line.kind !== "sending" && last && <p className="text-[12px] text-ink-tertiary">{t(last.reason === "auto" || last.reason === "first" ? "cloudSend.result.auto" : "cloudSend.result.when", { when: localizedRelativeTime(last.at, activeLocale()) })}</p>}
        {send.error && send.error !== last?.error && <p role="alert" className="text-[13px] text-danger">{send.error}</p>}
      </div>}
      <div className="flex items-start justify-between gap-4 rounded-lg bg-raised/60 p-3">
        <div className="min-w-0">
          <div id="cloud-send-auto" className="text-[13px] font-medium text-ink">{t("cloudSend.auto")}</div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{t("cloudSend.autoHelp")}</p>
        </div>
        <Switch checked={snapshot.auto} aria-labelledby="cloud-send-auto" data-cloud-send-auto onClick={() => void send.setAuto(!snapshot.auto)} />
      </div>
      <p className="text-[12px] leading-relaxed text-ink-secondary" data-cloud-send-separate>{t("cloudSend.separate")}</p>
      {ready && <div>
        <button type="button" aria-expanded={more} data-cloud-send-more className="inline-flex items-center gap-1 text-[12.5px] text-ink-secondary hover:text-ink" onClick={() => setMore(!more)}>
          <ChevronRight size={13} aria-hidden="true" className={more ? "rotate-90 transition-transform" : "transition-transform"} />{t("cloudSend.moreLink")}
        </button>
        {more && <div className="mt-2 flex flex-col items-start gap-3">
          <SideBySide snapshot={snapshot} />
          <button type="button" data-cloud-send-all className="ui-button inline-flex items-center gap-2" disabled={running} onClick={() => void send.sendAll()}>{t("cloudSend.send")}</button>
        </div>}
      </div>}
    </div>
  </Card>;
}
