import { useEffect, useState } from "react";
import { CloudUpload, Loader2 } from "lucide-react";
import type { CloudSendNotice, CloudSendPageBridge } from "../../electron/cloud-send.mjs";
import { failedLine, ipcErrorText, noticeLine } from "@/lib/cloud-send";
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

/** On My Cloud, in the desktop app: what the person's computer has that My Cloud lacks, and one click to bring it over.
 * Not now hides it until something new appears. Never on any other server, and never in a browser. */
export function CloudSendStrip({ cloudHome }: { cloudHome: boolean }) {
  const bridge = cloudHome && !window.ogb?.remoteClient?.active ? window.ogb?.cloudSendPage : undefined;
  const [notice, setNotice] = useCloudSendNotice(bridge);
  const [phase, setPhase] = useState<"idle" | "sending" | "done" | "failed">("idle");
  const [unanswered, setUnanswered] = useState<string | null>(null);
  if (!bridge || !notice) return null;
  const line = noticeLine(notice);
  if (phase === "idle" && (!notice.ready || notice.dismissed || !line)) return null;
  const bring = () => {
    setPhase("sending");
    setUnanswered(null);
    void bridge.send().then((next) => { setNotice(next); setPhase(next.last && (next.last.failed || next.last.error) ? "failed" : "done"); })
      .catch((cause: unknown) => { setUnanswered(ipcErrorText(cause)); setPhase("failed"); });
  };
  const failure = unanswered ? t("cloudSend.failedSend", { error: unanswered }) : (notice.last && failedLine(notice.last)) ?? t("cloudSend.strip.failed");
  const close = () => {
    setPhase("idle");
    if (notice.signature) void bridge.dismiss(notice.signature).then(setNotice).catch(() => {});
  };
  return <div role="status" data-cloud-send-strip={phase} className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-hairline/40 bg-panel px-3 py-1.5 text-[12.5px] text-ink-secondary">
    {phase === "sending" ? <Loader2 size={14} aria-hidden="true" className="animate-spin" /> : <CloudUpload size={14} aria-hidden="true" />}
    <span dir="auto" data-cloud-send-strip-line>{phase === "sending" ? t("cloudSend.strip.sending") : phase === "done" ? t("cloudSend.strip.done") : phase === "failed" ? failure : line!.text}</span>
    {phase === "idle" && <>
      <button type="button" data-cloud-send-bring className="font-medium text-accent-text underline underline-offset-2 hover:text-ink" onClick={bring}>{t(line!.one ? "cloudSend.strip.bringOne" : "cloudSend.strip.bring")}</button>
      <span aria-hidden="true">·</span>
      <button type="button" data-cloud-send-not-now className="hover:text-ink" onClick={close}>{t("notice.notNow")}</button>
    </>}
    {phase === "failed" && <>
      <button type="button" data-cloud-send-retry className="font-medium text-accent-text underline underline-offset-2 hover:text-ink" onClick={bring}>{t("cloudSend.strip.retry")}</button>
      <span aria-hidden="true">·</span>
    </>}
    {(phase === "done" || phase === "failed") && <button type="button" className="hover:text-ink" onClick={close}>{t("cloudSend.strip.close")}</button>}
  </div>;
}
