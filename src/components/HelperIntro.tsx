import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/cn";
import { introStaged, setupSteps, stageIntro, useWelcomingBot, type SetupStep } from "@/lib/default-bot";
import { activeLocale, t } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { detectSetupWithin, localSetupImport, setupImportApi } from "@/lib/setup-import";
import type { LocaleKey } from "@/locales";
import { api, useStore, type Bot, type InstanceInfo, type Message } from "@/state/store";
import { BotAvatar } from "./Avatar";
import { joinedCorners, SIMPLE_BOT_BUBBLE, SIMPLE_BUBBLE_MAX } from "./chat-bubble";
import { loadAppCards } from "./bot-settings/useBotApps";
import { freeFallback } from "../../shared/ai-ranking";
import { engineReady } from "./EngineLibrary";
import { HelperSetup } from "./HelperSetup";
import { usePrefersReducedMotion } from "./mascot-clock";
import { preloadConnectedApps } from "./PluginsPanel";

export const HELPER_ASK_KEYS: readonly LocaleKey[] = [
  "helperIntro.ask.overview", "helperIntro.ask.inbox", "helperIntro.ask.routine", "helperIntro.ask.howto",
];

/** Advanced mode's bot bubble; Simple's is the chat's own (chat-bubble.ts). */
const ADVANCED_BUBBLE = "max-w-[min(var(--chat-bubble-max),var(--chat-bubble-pct))] rounded-2xl bg-card px-4 py-2.5 text-[15px] leading-relaxed text-ink";
/** How long each bubble is "typed" before it arrives, as a first run lands in the chat. */
export const ARRIVAL_MS: readonly number[] = [350, 800, 900, 1_500];
const MAX_APP_NAMES = 3;
const LOOK_MS = 3_000;

export interface LookAround {
  /** The AI this bot thinks with, when one of the person's own works. */
  ai?: string;
  /** OpenCode's free model, when it is all that works: a backup, never the person's own AI. */
  backup?: string;
  /** Apps connected for every bot here; null until known. */
  apps: string[] | null;
  phonePaired?: boolean;
  importFound?: boolean;
}

const ROLE_LINES = {
  chief: { hi: "helperIntro.hi.chief", named: "helperIntro.hi.chiefNamed", lead: "helperIntro.lead.chief" },
  helper: { hi: "helperIntro.hi.helper", named: "helperIntro.hi.helperNamed", lead: "helperIntro.lead.helper" },
  member: { hi: "helperIntro.hi.helper", named: "helperIntro.hi.helperNamed", lead: "helperIntro.lead.member" },
} as const satisfies Record<string, Record<string, LocaleKey>>;

/** MausBot's first three bubbles: who it is, what to ask it, and that it is looking around. A Team Cloud member's
 * MausBot leaves their day to the team's Chief. */
export function introLines(input: { name: string; chief: boolean; person?: string; team?: string }): string[] {
  const role = ROLE_LINES[input.chief ? "chief" : input.team ? "member" : "helper"];
  return [
    input.person ? t(role.named, { name: input.name, person: input.person }) : t(role.hi, { name: input.name }),
    [t(role.lead), input.team ? t("helperIntro.team", { team: input.team }) : ""].filter(Boolean).join(" "),
    t("helperIntro.looking"),
  ];
}

function names(apps: readonly string[]): string {
  const shown = apps.slice(0, MAX_APP_NAMES);
  const rest = apps.length - shown.length;
  const list = rest > 0 ? [...shown, t("helperIntro.look.more", { count: rest })] : shown;
  return new Intl.ListFormat(activeLocale(), { style: "long", type: "conjunction" }).format(list);
}

/** What the look around found, in one plain bubble that ends on the next step. */
export function lookAroundReport(look: LookAround, steps: readonly SetupStep[]): string {
  if (!look.ai) return look.backup ? t("helperIntro.look.backup", { ai: look.backup }) : t("helperIntro.look.noAi");
  const apps = look.apps ?? [];
  const found = apps.length ? t("helperIntro.look.aiApps", { ai: look.ai, apps: names(apps) }) : `${t("helperIntro.look.ai", { ai: look.ai })} ${t("helperIntro.look.noApps")}`;
  return `${found} ${steps.length ? t("helperIntro.look.next") : t("helperIntro.look.go")}`;
}

function thinksWith(bot: Bot | undefined, instances: readonly InstanceInfo[]): Pick<LookAround, "ai" | "backup"> {
  const works = (instance: InstanceInfo) => engineReady(instance) && !freeFallback(instance);
  const own = instances.find((instance) => instance.instanceId === bot?.modelSelection.instanceId && works(instance)) ?? instances.find(works);
  return { ai: own?.displayName, backup: instances.find((instance) => engineReady(instance) && freeFallback(instance))?.displayName };
}

/** A real look around, without asking an AI: the apps connected here, a paired phone, skills to bring in. Settles
 * within LOOK_MS; anything not known by then is left out. `deep` also looks for skills on this computer. */
function useLookAround(deep: boolean): { apps: string[] | null; phonePaired?: boolean; importFound?: boolean; settled: boolean } {
  const [found, setFound] = useState<{ apps: string[] | null; phonePaired?: boolean; importFound?: boolean; settled: boolean }>({ apps: null, settled: false });
  useEffect(() => {
    let active = true;
    const apps = Promise.all([preloadConnectedApps(), loadAppCards()])
      .then(([inventory, cards]) => Object.entries(inventory.services).filter(([, status]) => status.connected)
        .map(([slug]) => cards.get(slug)?.label ?? slug))
      .catch(() => null);
    const phones = api<{ phones?: unknown[] }>("/api/phones").then((response) => (response.phones?.length ?? 0) > 0).catch(() => undefined);
    const look = deep && localSetupImport(false) ? detectSetupWithin(setupImportApi) : null;
    const timer = setTimeout(() => { if (active) setFound((now) => ({ ...now, settled: true })); }, LOOK_MS);
    void Promise.all([apps, phones, look?.found ?? null]).then(([appNames, phonePaired, detection]) => {
      if (active) setFound({ apps: appNames, phonePaired, importFound: Boolean(detection), settled: true });
    });
    return () => {
      active = false;
      clearTimeout(timer);
      look?.cancel();
    };
  }, [deep]);
  return found;
}

/** How many of `count` bubbles are in: all at once, or one at a time when a first run has just landed here
 * (stageIntro), the last only once `ready`. Staging starts when the intro is first seen, not when it mounts: it mounts
 * hidden behind the Chief screen. */
function useArrival(botId: string, count: number, ready: boolean, hidden: boolean): { shown: number; typing: boolean; staged: boolean } {
  const reduced = usePrefersReducedMotion();
  const [run, setRun] = useState<number | null>(null);
  const due = !hidden && !reduced && introStaged(botId);
  useEffect(() => {
    if (!due) return;
    stageIntro(null);
    setRun(0);
  }, [due]);
  useEffect(() => {
    if (run === null) return;
    if (run >= count) {
      setRun(null);
      return;
    }
    if (run === count - 1 && !ready) return;
    const timer = setTimeout(() => setRun((now) => (now === null ? null : now + 1)), ARRIVAL_MS[Math.min(run, ARRIVAL_MS.length - 1)]);
    return () => clearTimeout(timer);
  }, [run, count, ready]);
  const staged = due || run !== null;
  const shown = run ?? (due ? 0 : count);
  return { shown, typing: staged && shown < count, staged };
}

/** MausBot's first messages, in the viewer's language: three short bubbles, then what it found looking around and chips
 * for what is still missing. The chips go once the person writes anything after it or it is dismissed (`answered`). */
export function HelperIntro({ botId, threadId, message, answered }: { botId: string; threadId: string; message: Message; answered: boolean }) {
  const { state, dispatch } = useStore();
  const advanced = useAdvancedMode();
  const welcoming = useWelcomingBot();
  const bot = state.bots.find((candidate) => candidate.id === botId);
  const team = bot?.defaultBot?.person ? state.config?.team?.name : undefined;
  const person = state.config?.profile?.name?.trim().split(/\s+/)[0] || undefined;
  const lines = introLines({ name: bot?.name ?? "MausBot", chief: Boolean(bot?.chiefOfStaff), person, team });
  const found = useLookAround(!answered);
  const look: LookAround = { ...thinksWith(bot, state.instances), ...found };
  const steps = answered ? [] : setupSteps({
    aiReady: Boolean(look.ai),
    ownBots: state.bots.filter((candidate) => !candidate.hidden && !candidate.defaultBot).length,
    onCloud: state.config?.cloudHome === true,
    team: Boolean(state.config?.team),
    remote: typeof window !== "undefined" && window.ogb?.remoteClient?.active === true,
    appsConnected: Boolean(look.apps?.length),
    phonePaired: look.phonePaired,
    importFound: look.importFound,
  });
  const bubbles = [...lines, lookAroundReport(look, steps)];
  const hidden = welcoming === botId;
  const { shown, typing, staged } = useArrival(botId, bubbles.length, found.settled, hidden);
  if (hidden) return null;
  const visible = bubbles.slice(0, found.settled ? shown : Math.min(shown, lines.length));
  const ask = (key: LocaleKey) => dispatch({ type: "answerCard", botId, threadId, messageId: message.id, answer: t(key) });
  return (
    <div data-helper-intro={message.id} className={cn("flex w-full flex-col items-start", advanced ? "gap-1.5" : "gap-1")}>
      {visible.map((text, index) => (
        <div
          key={index}
          data-chat-bubble={advanced ? "" : "simple"}
          data-helper-line={index}
          className={cn("w-fit", advanced ? ADVANCED_BUBBLE
            : cn(SIMPLE_BUBBLE_MAX, SIMPLE_BOT_BUBBLE, joinedCorners("start", { above: index > 0, below: index < visible.length - 1 })),
          staged && "animate-msg-in")}
        >
          {text}
        </div>
      ))}
      {typing && bot && (
        <div role="status" data-helper-typing="" className="flex items-center gap-2 py-0.5">
          <BotAvatar bot={bot} size={28} state="thinking" />
          <span className="text-[14px] text-ink-tertiary">{t("helperIntro.typing")}</span>
        </div>
      )}
      {visible.length === bubbles.length && <HelperSetup steps={steps} />}
      {advanced && !answered && (
        <div role="group" aria-label={t("helperIntro.asks")} className="flex max-w-full flex-wrap items-center gap-1.5">
          {HELPER_ASK_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              data-helper-ask={key}
              onClick={() => ask(key)}
              className="rounded-full border border-hairline/60 bg-app px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover"
            >
              {t(key)}
            </button>
          ))}
          <button
            type="button"
            data-helper-dismiss=""
            onClick={() => dispatch({ type: "dismissCard", botId, threadId, messageId: message.id })}
            aria-label={t("helperIntro.dismiss")}
            title={t("helperIntro.dismiss")}
            className="flex size-7 items-center justify-center rounded-full text-ink-tertiary hover:bg-raised-hover hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
