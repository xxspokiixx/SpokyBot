import { useEffect, useState } from "react";
import { CloudUpload, Loader2 } from "lucide-react";
import { resultKey } from "../../electron/cloud-send-parts.mjs";
import type { CloudSendNotice, CloudSendPageBridge } from "../../electron/cloud-send.mjs";
import { ipcErrorText, stripLine } from "@/lib/cloud-send";
import { t } from "@/lib/i18n";

/** My Cloud's notice from main, kept fresh. */
export function useCloudSendNotice(bridge: CloudSendPageBridge | undefined) {
  const [notice, setNotice] = useState<CloudSendNotice | null>(null);
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    const unsubscribe = bridge.onNotice((next) => { if (alive) setNotice(next); });
    void bridge.notice().then((next) => { if (alive) setNotice(next); }).catch(() => {});
    return () => { alive = false; unsubscribe(); };
  }, [bridge]);
  return [notice, setNotice] as const;
}

/** On My Cloud, in the desktop app: this computer's things arriving by themselves (the first time, with progress), what
 * arrived, and anything that couldn't come with why and one Try again. Nothing to press when all is well. Never on any
 * other server, and never in a browser. */
export function CloudSendStrip({ cloudHome }: { cloudHome: boolean }) {
  const bridge = cloudHome && !window.ogb?.remoteClient?.active ? window.ogb?.cloudSendPage : undefined;
  const [notice, setNotice] = useCloudSendNotice(bridge);
  const [sending, setSending] = useState(false);
  const [unanswered, setUnanswered] = useState<string | null>(null);
  // A desktop from before Close was kept never marks a result seen, so Close is remembered here too.
  const [closedAt, setClosedAt] = useState<number | null>(null);
  if (!bridge || !notice) return null;
  const last = notice.last && notice.last.at === closedAt ? { ...notice.last, seen: true } : notice.last;
  const retry = () => {
    setSending(true);
    setUnanswered(null);
    void bridge.send().then((next) => { setNotice(next); setSending(false); })
      .catch((cause: unknown) => { setUnanswered(ipcErrorText(cause) ?? t("cloudSend.status.unreachable")); setSending(false); });
  };
  const close = () => {
    setUnanswered(null);
    if (!last) return;
    setClosedAt(last.at);
    void bridge.dismiss(resultKey(last)).then(setNotice).catch(() => {});
  };
  const shown = stripLine({ ...notice, last }, sending, unanswered);
  if (!shown) return null;
  return <div role="status" data-cloud-send-strip={shown.kind} className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-hairline/40 bg-panel px-3 py-1.5 text-[12.5px] text-ink-secondary">
    {shown.kind === "sending" ? <Loader2 size={14} aria-hidden="true" className="animate-spin" /> : <CloudUpload size={14} aria-hidden="true" />}
    <span dir="auto" data-cloud-send-strip-line>{shown.text}</span>
    {shown.kind === "failed" && (unanswered !== null || last?.final !== true) && <>
      <button type="button" data-cloud-send-retry className="font-medium text-accent-text underline underline-offset-2 hover:text-ink" onClick={retry}>{t("cloudSend.strip.retry")}</button>
      <span aria-hidden="true">·</span>
    </>}
    {shown.kind !== "sending" && <button type="button" className="hover:text-ink" onClick={close}>{t("cloudSend.strip.close")}</button>}
  </div>;
}
