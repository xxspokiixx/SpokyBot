import { useEffect, useState } from "react";
import { Check, Loader2, Zap, ExternalLink, TerminalSquare, AlertCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";
import { inputCls } from "./field";

export function NvidiaNimSection({
  configStatus,
}: {
  configStatus: ConfigStatus | undefined;
}) {
  const { dispatch } = useStore();
  const nvidiaNim = configStatus?.nvidiaNim;

  const [keyDraft, setKeyDraft] = useState("");
  const [baseUrl, setBaseUrl] = useState(nvidiaNim?.baseUrl ?? "https://integrate.api.nvidia.com/v1");
  const [savingKey, setSavingKey] = useState(false);
  const [savingUrl, setSavingUrl] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveToast, setSaveToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (nvidiaNim?.baseUrl) {
      setBaseUrl(nvidiaNim.baseUrl);
    }
  }, [nvidiaNim?.baseUrl]);

  // Clear toast after 3 seconds
  useEffect(() => {
    if (saveToast) {
      const timer = setTimeout(() => setSaveToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveToast]);

  const handleKeyChange = (value: string) => {
    setKeyDraft(value);
    if (error) setError(null);
  };

  const handleUrlChange = (value: string) => {
    setBaseUrl(value);
    if (error) setError(null);
  };

  const saveKey = async () => {
    const nextKey = keyDraft.trim();
    if (!nextKey || savingKey) {
      setSaveToast({ type: "error", message: "Enter an API key first" });
      return;
    }
    setSavingKey(true);
    setError(null);
    try {
      const body = { nvidiaNim: { key: nextKey, baseUrl: baseUrl.trim() || undefined } };
      const config: ConfigStatus = await api("/api/config", { method: "PUT", body: JSON.stringify(body) });
      dispatch({ type: "configStatus", config });
      setKeyDraft("");
      setSaveToast({ type: "success", message: "API key saved" });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save API key");
      setSaveToast({ type: "error", message: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setSavingKey(false);
    }
  };

  const saveBaseUrl = async () => {
    const nextUrl = baseUrl.trim();
    if (!nextUrl || savingUrl) {
      setSaveToast({ type: "error", message: "Enter a base URL first" });
      return;
    }
    if (!/^https?:\/\//i.test(nextUrl)) {
      setError(t("nvidiaNim.baseUrlError"));
      setSaveToast({ type: "error", message: t("nvidiaNim.baseUrlError") });
      return;
    }
    setSavingUrl(true);
    setError(null);
    try {
      const body = { nvidiaNim: { baseUrl: nextUrl, key: nvidiaNim?.configured ? undefined : keyDraft.trim() || undefined } };
      const config: ConfigStatus = await api("/api/config", { method: "PUT", body: JSON.stringify(body) });
      dispatch({ type: "configStatus", config });
      setSaveToast({ type: "success", message: "Base URL saved" });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save base URL");
      setSaveToast({ type: "error", message: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setSavingUrl(false);
    }
  };

  const isAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

  const installLaunchers = async () => {
    if (installing) return;
    if (isAndroid) {
      setInstallResult({ success: false, message: t("nvidiaNim.launchersDesktopOnly") });
      return;
    }
    setInstalling(true);
    setInstallResult(null);
    setError(null);
    try {
      const commands = [
        "npm link om-claude om-opencode om-codex",
        "npm install -g om-claude om-opencode om-codex",
      ];
      let success = false;
      for (const cmd of commands) {
        const opened = await window.ogb?.openInstallTerminal?.(cmd);
        if (opened) {
          success = true;
          break;
        }
      }
      if (success) {
        setInstallResult({ success: true, message: t("nvidiaNim.launchersInstalled") });
      } else {
        setInstallResult({ success: false, message: t("nvidiaNim.launchersInstallError") });
      }
    } catch (e: unknown) {
      setInstallResult({ success: false, message: e instanceof Error ? e.message : t("nvidiaNim.launchersInstallError") });
    } finally {
      setInstalling(false);
    }
  };

  const configured = nvidiaNim?.configured === true;

  return (
    <div className="rounded-xl bg-card p-4">
      <div className="flex items-center gap-2">
        <Zap className="size-5 text-accent" />
        <div className="text-[15px] font-medium text-ink">{t("nvidiaNim.title")}</div>
      </div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">{t("nvidiaNim.description")}</div>

      {saveToast && (
        <div
          className={cn("mt-2 flex items-center gap-2 text-[12px] px-2 py-1.5 rounded", saveToast.type === "success" ? "text-success bg-success/10" : "text-danger bg-danger/10")}
          role="alert"
        >
          <AlertCircle size={13} className="shrink-0" />
          {saveToast.message}
        </div>
      )}

      <div className="mt-4">
        <div className="mb-1.5 flex items-center gap-2 text-[13px] text-ink-secondary">
          <span className={cn("size-1.5 rounded-full", configured ? "bg-success" : "bg-raised-hover")} />
          <span>{t("nvidiaNim.apiKey")}</span>
          {configured && <span className="text-[11px] text-success">{t("nvidiaNim.configured")}</span>}
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            value={keyDraft}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleKeyChange(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && keyDraft.trim() && void saveKey()}
            placeholder={configured ? "••••••••  (paste to replace)" : t("nvidiaNim.apiKeyPlaceholder")}
            aria-label={t("nvidiaNim.apiKey")}
            autoComplete="off"
            className={inputCls}
          />
          <button
            onClick={() => void saveKey()}
            disabled={savingKey || !keyDraft.trim()}
            className="flex w-[72px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-control py-2 text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingKey ? <Loader2 size={13} className="animate-spin" /> : <><Check size={13} />{t("common.save")}</>}
          </button>
        </div>
        {!configured && (
          <a
            href={t("nvidiaNim.keyUrl")}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
          >
            {t("nvidiaNim.getKey")}
            <ExternalLink size={11} />
          </a>
        )}
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center gap-2 text-[13px] text-ink-secondary">
          <span>{t("nvidiaNim.baseUrl")}</span>
          {configured && <span className="text-[11px] text-success">{t("common.saved")}</span>}
        </div>
        <div className="flex gap-2">
          <input
            type="url"
            value={baseUrl}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleUrlChange(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && void saveBaseUrl()}
            placeholder={t("nvidiaNim.baseUrlPlaceholder")}
            aria-label={t("nvidiaNim.baseUrl")}
            autoComplete="off"
            spellCheck={false}
            className={inputCls}
          />
          <button
            onClick={() => void saveBaseUrl()}
            disabled={savingUrl || !baseUrl.trim()}
            className="flex w-[72px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-control py-2 text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingUrl ? <Loader2 size={13} className="animate-spin" /> : <><Check size={13} />{t("common.save")}</>}
          </button>
        </div>
      </div>

      <div className="mt-6 border-t border-hairline/40 pt-4">
        <div className="mb-2 text-[13px] text-ink-secondary">{t("nvidiaNim.cliLaunchers")}</div>
        <div className="text-[11.5px] leading-relaxed text-ink-secondary mb-3">{t("nvidiaNim.cliLaunchersDescription")}</div>
        <button
          onClick={() => void installLaunchers()}
          disabled={installing}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-hairline/40 bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {installing ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              {t("nvidiaNim.installingLaunchers")}
            </>
          ) : (
            <>
              <TerminalSquare size={13} />
              {t("nvidiaNim.installLaunchers")}
            </>
          )}
        </button>
        {installResult && (
          <div className={cn("mt-2 text-[12px]", installResult.success ? "text-success" : "text-danger")}>
            {installResult.message}
          </div>
        )}
      </div>

      {error && <div role="alert" className="mt-2 text-[12px] text-danger">{error}</div>}
    </div>
  );
}