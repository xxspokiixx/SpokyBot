import { useEffect, useRef, useState } from "react";
import type { ManagedDesktopState } from "../../electron/managed-desktop.mjs";
import { activeLocale, t } from "@/lib/i18n";
import { Card } from "./SettingsPrimitives";

const providerNames: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", openrouter: "OpenRouter" };

/** Only the trusted desktop bridge can enroll this computer or hold its token. */
export function OrganizationSettings() {
  const bridge = window.ogb?.remoteClient?.active ? undefined : window.ogb?.organization;
  const [connection, setConnection] = useState<ManagedDesktopState | null>(null);
  const [address, setAddress] = useState("https://admin.openmausbot.com");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const revision = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    const initialRevision = revision.current;
    const receive = (next: ManagedDesktopState) => {
      if (generation.current !== current) return;
      revision.current++;
      setConnection(previous => {
        // Heartbeats republish every minute; keep an action error visible until
        // the connection actually changes state.
        if (previous?.status !== next.status) setError("");
        return next;
      });
      if (next.status !== "connected" && next.status !== "reauth-required") setConfirmDisconnect(false);
    };
    const unsubscribe = bridge?.onState(receive);
    void bridge?.state().then((next) => {
      // A push can arrive while the initial snapshot is in flight.
      if (revision.current === initialRevision) receive(next);
    }).catch(() => {
      if (generation.current === current && revision.current === initialRevision) setError(t("organization.loadFailed"));
    });
    return () => { generation.current++; unsubscribe?.(); };
  }, [bridge]);

  const perform = async (action: () => Promise<ManagedDesktopState>) => {
    if (!bridge || pending.current) return;
    pending.current = true;
    setBusy(true); setError("");
    const current = generation.current;
    const startedRevision = revision.current;
    try {
      const next = await action();
      if (generation.current === current && revision.current === startedRevision) {
        setConnection(next);
        if (next.status !== "connected" && next.status !== "reauth-required") setConfirmDisconnect(false);
      }
    } catch {
      // IPC exceptions can contain internal paths; display only product copy.
      if (generation.current === current && revision.current === startedRevision) setError(t("organization.actionFailed"));
    } finally {
      pending.current = false;
      if (generation.current === current) setBusy(false);
    }
  };

  if (!bridge) return <p className="text-[13px] text-ink-secondary">{t("organization.desktopOnly")}</p>;
  // Unavailable can still hold a saved grant; let the person clear it before
  // reconnecting even while the Admin portal or local runtime is offline.
  const enrolled = connection?.status === "connected" || connection?.status === "reauth-required" || connection?.status === "unavailable";
  const expiry = connection?.enrollment?.expiresAt ?? connection?.expiresAt;
  const date = typeof expiry === "number" && Number.isFinite(expiry) ? new Date(expiry) : null;
  const dateLabel = date && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(activeLocale(), { dateStyle: "medium", timeStyle: "short" }).format(date) : null;
  return <>
    <p className="text-[13px] leading-relaxed text-ink-secondary">{t("organization.additive")}</p>
    <Card title={t("settings.section.organization")} subtitle={t("organization.privacy")}>
      {!connection && <p role="status" className="text-[13px] text-ink-secondary">{error || t("organization.loading")}</p>}
      {connection?.message && <p role="status" className="mb-3 text-[13px] text-ink-secondary">{connection.message}</p>}
      {connection?.status === "signed-out" && <form className="flex flex-col gap-3" onSubmit={(event) => {
        event.preventDefault();
        if (address.trim()) void perform(() => bridge.begin({ portalOrigin: address.trim() }));
      }}>
        <p className="text-[13px] text-ink-secondary">{t("organization.signInHelp")}</p>
        <label className="flex flex-col gap-1.5 text-[12px] text-ink-secondary">{t("organization.address")}
          <input type="url" required value={address} disabled={busy} onChange={(event) => setAddress(event.target.value)}
            autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} maxLength={2048}
            className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent/50" />
        </label>
        <button type="submit" disabled={busy || !address.trim()} className="ui-button w-fit">{busy ? t("organization.working") : t("organization.signIn")}</button>
      </form>}
      {connection?.status === "connecting" && <div className="flex flex-col items-start gap-3">
        <p role="status" className="text-[13px] text-ink-secondary">{t("organization.browserConsent")}</p>
        {connection.enrollment && <>
          <div className="text-[12px] text-ink-secondary">{t("organization.code")}</div>
          <code dir="ltr" className="select-all rounded-lg bg-inset px-4 py-3 text-xl tracking-widest text-ink">{connection.enrollment.userCode}</code>
          <p dir="ltr" className="break-all text-[12px] text-ink-secondary">{connection.enrollment.verificationUri}</p>
        </>}
        <button type="button" disabled={busy} className="ui-button" onClick={() => void perform(() => bridge.cancelEnrollment())}>{t("organization.cancel")}</button>
      </div>}
      {enrolled && <div className="flex flex-col gap-3">
        <div><div className="break-words text-[15px] font-medium text-ink">{connection.organization?.name}</div>
          <div className="break-all text-[13px] text-ink-secondary">{connection.email}</div></div>
        {connection.status === "reauth-required" ? <p role="alert" className="text-[13px] text-ink-secondary">{t("organization.reauth")}</p> : connection.status === "connected" ? <>
          <p className="text-[13px] text-ink-secondary">{t("organization.modelHelp")}</p>
          {connection.providers?.some((provider) => provider.configured && provider.models.length > 0) ?
            <ul className="divide-y divide-hairline/40">{connection.providers.map((provider) => <li key={provider.id} className="flex flex-wrap justify-between gap-2 py-2 text-[13px]">
              <span className="text-ink">{providerNames[provider.id] ?? provider.id}</span>
              <span className="text-ink-secondary">{provider.configured ? t("organization.modelCount", { count: provider.models.length }) : t("organization.notConfigured")}</span>
            </li>)}</ul> : <p className="text-[13px] text-ink-secondary">{t("organization.noModels")}</p>}
        </> : null}
        {confirmDisconnect ? <div role="group" aria-label={t("organization.disconnectTitle")} className="rounded-lg border border-hairline/40 p-3">
          <p className="text-[13px] text-ink">{t("organization.disconnectWarning")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" autoFocus disabled={busy} className="ui-button" onClick={() => setConfirmDisconnect(false)}>{t("organization.keepConnection")}</button>
            <button type="button" disabled={busy} className="ui-button text-danger" onClick={() => void perform(() => bridge.disconnect())}>{t("organization.disconnectConfirm")}</button>
          </div>
        </div> : <div className="flex flex-wrap gap-2">
          {connection.status !== "reauth-required" && <button type="button" disabled={busy} className="ui-button" onClick={() => void perform(() => bridge.refresh())}>{t("organization.refresh")}</button>}
          <button type="button" disabled={busy} className="ui-button" onClick={() => setConfirmDisconnect(true)}>{t("organization.disconnect")}</button>
        </div>}
      </div>}
      {connection?.status === "unavailable" && <p role="status" className="text-[13px] text-ink-secondary">{t("organization.unavailable")}</p>}
      {dateLabel && <p className="mt-3 text-[12px] text-ink-secondary">{t("organization.expires", { date: dateLabel })}</p>}
      {error && connection && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
      {!connection && <button type="button" disabled={busy} className="ui-button mt-3" onClick={() => void perform(() => bridge.refresh())}>{t("organization.refresh")}</button>}
    </Card>
  </>;
}
