import { AppWindow, Bot as BotIcon, Cloud, Download, Smartphone, Sparkles, type LucideIcon } from "lucide-react";

import { t } from "@/lib/i18n";
import type { SetupStep } from "@/lib/default-bot";
import { phonePairingSettingsAction } from "@/lib/phone-pairing";
import type { LocaleKey } from "@/locales";
import { useStore, type Action } from "@/state/store";

const STEPS: Record<SetupStep, { label: LocaleKey; icon: LucideIcon }> = {
  ai: { label: "helperIntro.chip.ai", icon: Sparkles },
  apps: { label: "helperIntro.chip.apps", icon: AppWindow },
  bots: { label: "helperIntro.chip.bots", icon: BotIcon },
  phone: { label: "helperIntro.chip.phone", icon: Smartphone },
  cloud: { label: "helperIntro.chip.cloud", icon: Cloud },
  import: { label: "helperIntro.chip.import", icon: Download },
};

/** Each step opens the app's own flow for it. */
export function setupAction(step: SetupStep): Action {
  switch (step) {
    case "ai": return { type: "toggleAppSettings", open: true, section: "engines" };
    case "apps": return { type: "togglePlugins", open: true, surface: "apps" };
    case "bots": return { type: "newBot" };
    case "phone": return phonePairingSettingsAction();
    case "cloud": return { type: "openCloudAdd", source: "app_onboarding" };
    case "import": return { type: "toggleAppSettings", open: true, section: "import" };
  }
}

/** What is still missing, as chips under MausBot's first look around. */
export function HelperSetup({ steps }: { steps: readonly SetupStep[] }) {
  const { dispatch } = useStore();
  if (!steps.length) return null;
  return (
    <div role="group" aria-label={t("helperIntro.setup")} data-helper-setup="" className="animate-rise flex max-w-full flex-wrap gap-1.5 pt-1">
      {steps.map((step) => {
        const { label, icon: Icon } = STEPS[step];
        return (
          <button key={step} type="button" data-helper-step={step} onClick={() => dispatch(setupAction(step))}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-card px-3 text-[13px] text-ink transition-colors hover:bg-raised-hover">
            <Icon size={14} aria-hidden="true" className="text-ink-secondary" />{t(label)}
          </button>
        );
      })}
    </div>
  );
}
