import { useEffect, useState } from "react";
import { CloudUpload, Loader2 } from "lucide-react";
import { MOVE_LINE, resultKey } from "../../electron/cloud-send-parts.mjs";
import type { CloudSendNotice, CloudSendPageBridge } from "../../electron/cloud-send.mjs";
import { ipcErrorText, moveLine, stripLine } from "@/lib/cloud-send";
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

/** In the desktop app, never in a browser: the one-time move's line on either page (on its way, what arrived, coming
 * home), and on My Cloud this computer's things arriving with anything that couldn't come and one Try again. Nothing to
 * press when all is well. */
export function CloudSendStrip({ cloudHome, onPairPhone }: { cloudHome: boolean; onPairPhone?: () => void }) {
  const bridge = !window.ogb?.remoteClient?.active ? window.ogb?.cloudSendPage : undefined;
  const [notice, setNotice] = useCloudSendNotice(bridge);
  const [sending, setSending] = useState(false);
  const [unanswered, setUnanswered] = useState<string | null>(null);
  if (!bridge || !notice) return null;
  const last = notice.last;
  const move = notice.move ? moveLine(notice.move, cloudHome ? "cloud" : "local") : null;
  const retry = () => {
    setSending(true);
    setUnanswered(null);
    const asked = move?.retry ? bridge.moveRetry?.() : bridge.send();
    void (asked ?? Promise.resolve(notice)).then((next) => { setNotice(next); setSending(false); })
      .catch((cause: unknown) => { setUnanswered(ipcErrorText(cause) ?? t("cloudSend.status.unreachable")); setSending(false); });
  };
  const close = () => {
    setUnanswered(null);
    if (move) void bridge.dismiss(MOVE_LINE).then(setNotice).catch(() => {});
    else if (last) void bridge.dismiss(resultKey(last)).then(setNotice).catch(() => {});
  };
  const shown = move ?? (cloudHome ? stripLine(notice, sending, unanswered) : null);
  if (!shown) return null;
  const extra = move?.extra ?? [];
  return <div role="status" data-cloud-send-strip={shown.kind} {...(move ? { "data-move-line": notice.move!.phase } : {})} className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-hairline/40 bg-panel px-3 py-1.5 text-[12.5px] text-ink-secondary">
    {shown.kind === "sending" || sending ? <Loader2 size={14} aria-hidden="true" className="animate-spin" /> : <CloudUpload size={14} aria-hidden="true" />}
    <span dir="auto" data-cloud-send-strip-line>{shown.text}</span>
    {extra.map((line) => <span key={line} dir="auto" data-move-line-extra>{line}</span>)}
    {move?.phone && onPairPhone && <>
      <button type="button" data-move-phone className="font-medium text-accent-text underline underline-offset-2 hover:text-ink" onClick={onPairPhone}>{t("cloudSend.move.phone")}</button>
      <span aria-hidden="true">·</span>
    </>}
    {shown.kind === "failed" && (move ? move.retry : unanswered !== null || last?.final !== true) && !sending && <>
      <button type="button" data-cloud-send-retry className="font-medium text-accent-text underline underline-offset-2 hover:text-ink" onClick={retry}>{t("cloudSend.strip.retry")}</button>
      <span aria-hidden="true">·</span>
    </>}
    {(move ? shown.kind === "done" : shown.kind !== "sending") && <button type="button" className="hover:text-ink" onClick={close}>{t("cloudSend.strip.close")}</button>}
  </div>;
}
