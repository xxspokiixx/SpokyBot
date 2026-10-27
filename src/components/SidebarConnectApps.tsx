import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";

import { loadAppCards } from "./bot-settings/useBotApps";
import { preloadConnectedApps, type ToolkitCard } from "./PluginsPanel";
import { ELEVATED_CONTROL, ELEVATED_HOVER } from "./elevated";

export type AppFace = Pick<ToolkitCard, "slug" | "label" | "logo" | "domain">;

export const POPULAR_APPS: readonly AppFace[] = [
  { slug: "gmail", label: "Gmail", logo: null, domain: "gmail.com" },
  { slug: "slack", label: "Slack", logo: null, domain: "slack.com" },
  { slug: "notion", label: "Notion", logo: null, domain: "notion.so" },
];

export const APP_FACES = 3;

export function appFaces(connected: readonly string[], cards: ReadonlyMap<string, AppFace>): AppFace[] {
  const own = connected.map((slug) => cards.get(slug)).filter((card): card is AppFace => Boolean(card));
  return [...own, ...POPULAR_APPS.filter((app) => !own.some((card) => card.slug === app.slug))].slice(0, APP_FACES);
}

function useAppFaces(): AppFace[] {
  const { state } = useStore();
  const [faces, setFaces] = useState<AppFace[]>(() => appFaces([], new Map()));
  useEffect(() => {
    if (state.pluginsOpen) return;
    let alive = true;
    void preloadConnectedApps()
      .then(async (inventory) => {
        const connected = Object.entries(inventory.services).filter(([, status]) => status.connected).map(([slug]) => slug).sort();
        const cards = connected.length > 0 ? await loadAppCards() : new Map<string, AppFace>();
        if (alive) setFaces(appFaces(connected, cards));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [state.pluginsOpen]);
  return faces;
}

function AppFaceIcon({ face, className }: { face: AppFace; className?: string }) {
  const sources = [face.logo, face.domain ? `https://www.google.com/s2/favicons?domain=${face.domain}&sz=64` : null].filter((src): src is string => Boolean(src));
  const [failed, setFailed] = useState(0);
  const src = sources[failed];
  return (
    <span data-app-face={face.slug} className={cn("flex size-[18px] shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-white ring-[1.5px] ring-composer", className)}>
      {src
        ? <img src={src} alt="" draggable={false} className="size-4 object-contain" onError={() => setFailed((count) => count + 1)} />
        : <span className="text-[10px] font-semibold leading-none text-neutral-700">{face.label.slice(0, 1).toUpperCase()}</span>}
    </span>
  );
}

export function SidebarConnectApps() {
  const { state, dispatch } = useStore();
  const faces = useAppFaces();
  return (
    <button
      type="button"
      data-tour="nav-apps"
      data-sidebar-nav="apps"
      aria-pressed={state.pluginsOpen}
      onClick={() => dispatch({ type: "togglePlugins", open: true })}
      className={cn("flex h-[34px] min-w-0 flex-1 items-center justify-center gap-[9px] rounded-full px-3 text-[15px] leading-5 text-ink", ELEVATED_CONTROL, ELEVATED_HOVER)}
    >
      <span className="min-w-0 truncate">{t("sidebar.connectApps")}</span>
      <span aria-hidden="true" className="flex shrink-0 items-center">
        {faces.map((face, index) => <AppFaceIcon key={face.slug} face={face} className={index > 0 ? "-ms-2" : undefined} />)}
      </span>
    </button>
  );
}
