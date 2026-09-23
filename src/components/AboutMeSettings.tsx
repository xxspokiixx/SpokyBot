import { useCallback, useEffect, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";

export function AboutMeSettings() {
  const { state, dispatch } = useStore();
  const confirmed = state.config?.profile?.aboutMe ?? "";
  const [value, setValue] = useState(confirmed);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const draft = useRef(confirmed);
  const dirty = useRef(false);
  const running = useRef(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (running.current || !dirty.current) return;
    running.current = true;
    if (mounted.current) setStatus("saving");
    try {
      // Serialize writes. Edits made during a save must follow that save,
      // and its response must never replace the newer draft.
      while (dirty.current) {
        const sent = draft.current;
        const config = await api<ConfigStatus>("/api/config", {
          method: "PUT", body: JSON.stringify({ profile: { aboutMe: sent } }), timeoutMs: 10_000,
        });
        dirty.current = draft.current !== sent;
        dispatch({ type: "configStatus", config });
      }
      if (mounted.current) setStatus("saved");
    } catch {
      if (mounted.current) setStatus("error");
    } finally {
      running.current = false;
    }
  }, [dispatch]);

  useEffect(() => {
    if (!dirty.current && !running.current) {
      draft.current = confirmed;
      setValue(confirmed);
    }
  }, [confirmed]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void flush();
    };
  }, [flush]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label htmlFor="profile-about-me" className="text-[14px] text-ink">{t("settings.profile.aboutMe")}</label>
        <details className="group relative">
          <summary title={t("settings.profile.aboutMeHelp")} aria-label={t("settings.profile.aboutMeHelp")}
            className="flex size-6 cursor-pointer list-none items-center justify-center rounded-md text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 [&::-webkit-details-marker]:hidden">
            <CircleHelp size={14} aria-hidden="true" />
          </summary>
          <p className="absolute left-0 z-30 mt-1 w-56 rounded-xl border border-hairline bg-panel p-3 text-[12px] text-ink-secondary shadow-xl">
            {t("settings.profile.aboutMeHelp")}
          </p>
        </details>
      </div>
      <textarea id="profile-about-me" value={value} rows={5} maxLength={24_000}
        onChange={(event) => {
          const next = event.target.value;
          draft.current = next;
          dirty.current = true;
          setValue(next);
          setStatus("idle");
          clearTimeout(timer.current);
          timer.current = setTimeout(() => void flush(), 600);
        }}
        onBlur={() => void flush()}
        className="min-h-[120px] w-full resize-y rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink focus:border-hairline focus:outline-none"
      />
      <div className="min-h-4 text-[12px]" role="status">
        {status === "saving" && <span className="text-ink-secondary">{t("settings.profile.saving")}</span>}
        {status === "saved" && <span className="text-success">{t("settings.profile.saved")}</span>}
        {status === "error" && <span className="text-danger">{t("settings.profile.saveError")} {" "}
          <button type="button" onClick={() => void flush()} className="underline">{t("settings.profile.retry")}</button>
        </span>}
      </div>
    </div>
  );
}
