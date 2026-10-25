// An engine whose CLI runs the copy OpenMausBot installed: the person's terminal does not reach it, so it is
// finished here, never with a terminal step.
import { Check, KeyRound } from "lucide-react";
import { useStore, type InstanceInfo } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { RefreshEngines } from "./EngineLibrary";

/** Installed but not signed in. Only OpenCode ships such a build today, and its free models need no account. */
export function AppCopySetup({ instance, className, unframed }: { instance: InstanceInfo; className?: string; unframed: boolean }) {
  const { dispatch } = useStore();
  const remote = window.ogb?.remoteClient?.active === true;
  return (
    <div data-engine-setup-app-copy className={cn(!unframed && "rounded-xl border border-hairline/40 bg-control/30 p-3", className)}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-inset text-ink-secondary">
          <Check size={14} />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink">{t("engineSetup.appCopy.title", { name: instance.displayName })}</div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">
            {t(remote ? "engineSetup.appCopy.remote" : "engineSetup.appCopy.description", { name: instance.displayName })}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!remote && (
          <button
            type="button"
            onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: "connections" })}
            className="flex items-center gap-1.5 rounded-lg bg-raised px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-raised-hover"
          >
            <KeyRound size={13} aria-hidden="true" />
            {t("engineSetup.apiKey.open")}
          </button>
        )}
        <RefreshEngines key={instance.instanceId} />
      </div>
    </div>
  );
}
