import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Crown } from "lucide-react";
import { BotAvatar, MausAvatar } from "@/components/Avatar";
import { usePrefersReducedMotion } from "@/components/mascot-clock";
import { cn } from "@/lib/cn";
import { chiefChoices, chiefFor, createChiefPatch, DEFAULT_BOT_NAME, myDefaultBot, setWelcomingBot, stageIntro, useViewerEmail } from "@/lib/default-bot";
import { t } from "@/lib/i18n";
import { landInSidebar } from "@/lib/mausbot-landing";
import { useStore, type Bot } from "@/state/store";

const PILL = "h-8 min-w-0 truncate rounded-full px-3 text-[14px] transition-colors duration-150";
const SECONDARY = "border-[0.5px] border-ink/[0.24] bg-transparent text-ink hover:bg-ink/[0.06] disabled:border-transparent disabled:bg-ink/[0.08] disabled:text-ink-tertiary disabled:hover:bg-ink/[0.08]";
const PRIMARY = "bg-ink text-app hover:bg-ink/90 disabled:bg-ink/[0.12] disabled:text-ink-tertiary";
const RECEDE_MS = 200;
const AVATAR_SIZE = 64;

function ChiefBadge() {
  return (
    <span aria-hidden="true" data-chief-badge="" className="absolute -bottom-px -right-px flex size-[18px] items-center justify-center rounded-full bg-[var(--identity-orange)] text-white ring-2 ring-menu">
      <Crown size={10} strokeWidth={2.5} fill="currentColor" />
    </span>
  );
}

/** Whether a bot's AI can direct other bots, which a Chief of Staff needs. */
function canLead(bot: Bot, instances: ReturnType<typeof useStore>["state"]["instances"]): boolean {
  return Boolean(bot.chiefOfStaff) || instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId)?.capabilities?.agentsMcp === true;
}

/** The first run's second screen, over the app: MausBot as the person's Chief of Staff (Create), or a bot they already
 * have (Choose, then Confirm). Create makes MausBot the Chief only where there is none; a Chief someone has is kept. It
 * asks for a choice, so Escape leaves only the list. */
export function ChiefIntro({ replay, onDone }: { replay: boolean; onDone: (botId: string | null) => void }) {
  const { state, dispatch } = useStore();
  const reduced = usePrefersReducedMotion();
  const viewer = useViewerEmail();
  const maus = myDefaultBot(state.bots, viewer);
  const chief = chiefFor(state.bots, maus);
  const choices = chiefChoices(state.bots, maus, viewer);
  const own = chief && chief.id !== maus?.id ? chief : undefined;
  const subject = own ?? maus;
  const [choosing, setChoosing] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const avatar = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!maus) return;
    setWelcomingBot(maus.id);
    return () => setWelcomingBot(null);
  }, [maus?.id]);
  useEffect(() => {
    const first = dialog.current?.querySelector<HTMLElement>(choosing ? "[role=radio][tabindex='0']" : "[data-primary]");
    (first ?? dialog.current)?.focus({ preventScroll: true });
  }, [choosing]);

  // The fade only shows the leaving; a timer finishes it, since a hidden window runs no animation to its end.
  const leave = (botId: string | null) => {
    if (reduced) {
      onDone(botId);
      return;
    }
    dialog.current?.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.98)" }],
      { duration: RECEDE_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" });
    setTimeout(() => onDone(botId), RECEDE_MS);
  };

  const create = () => {
    if (leaving || !maus) return;
    setLeaving(true);
    const patch = createChiefPatch(maus, chief);
    if (!replay) stageIntro(maus.id);
    landInSidebar({
      from: avatar.current,
      botId: maus.id,
      reduced,
      commit: () => {
        setWelcomingBot(null);
        dispatch({ type: "updateBot", botId: maus.id, patch });
      },
    });
    leave(maus.id);
  };

  const keep = (bot: Bot) => {
    if (leaving) return;
    setLeaving(true);
    setWelcomingBot(null);
    if (maus && !maus.welcomed) dispatch({ type: "updateBot", botId: maus.id, patch: { welcomed: true } });
    if (!bot.chiefOfStaff) dispatch({ type: "updateBot", botId: bot.id, patch: { chiefOfStaff: true } });
    leave(bot.id);
  };

  const enabled = choices.filter((bot) => canLead(bot, state.instances));
  const choice = enabled.find((bot) => bot.id === picked);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (choosing) setChoosing(false);
      return;
    }
    if (!choosing || !["ArrowDown", "ArrowUp"].includes(event.key) || !enabled.length) return;
    event.preventDefault();
    const at = enabled.findIndex((bot) => bot.id === picked);
    const next = enabled[(at + (event.key === "ArrowDown" ? 1 : enabled.length - 1)) % enabled.length]!;
    setPicked(next.id);
    dialog.current?.querySelector<HTMLElement>(`[data-chief-choice="${next.id}"]`)?.focus();
  };

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="chief-intro-title"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-chief-intro={choosing ? "choose" : "intro"}
      className={cn("animate-pop-in w-[440px] max-w-full rounded-[14px] border-[0.5px] border-ink/[0.12] bg-menu p-4 text-center outline-none",
        "shadow-[0_16px_40px_-16px_rgb(0_0_0/0.3)]", leaving && "pointer-events-none")}
    >
      {choosing ? (
        <>
          <h2 id="chief-intro-title" className="text-left text-[17px] font-medium leading-6 tracking-[-0.008em] text-ink">{t("onboarding.chief.chooseTitle")}</h2>
          <div role="radiogroup" aria-labelledby="chief-intro-title" className="-mx-1 mt-3 max-h-[min(320px,55vh)] overflow-y-auto px-1 text-left [scrollbar-width:thin]">
            {choices.map((bot) => {
              const able = canLead(bot, state.instances);
              const role = bot.chiefOfStaff ? t("chat.chiefOfStaff") : bot.title?.trim();
              const checked = picked === bot.id;
              return (
                <div
                  key={bot.id}
                  role="radio"
                  aria-checked={checked}
                  aria-disabled={!able || undefined}
                  tabIndex={checked || (!choice && bot.id === enabled[0]?.id) ? 0 : -1}
                  data-chief-choice={bot.id}
                  onClick={() => able && setPicked(bot.id)}
                  onKeyDown={(event) => {
                    if (able && (event.key === " " || event.key === "Enter")) {
                      event.preventDefault();
                      setPicked(bot.id);
                    }
                  }}
                  className={cn("flex items-center gap-3 rounded-[10px] px-2 py-1.5 transition-colors focus-visible:outline-offset-[-2px]",
                    able ? "cursor-pointer hover:bg-ink/[0.06]" : "opacity-50", checked && "bg-ink/[0.06]")}
                >
                  <BotAvatar bot={bot} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium leading-5 text-ink">{bot.name}</span>
                    {(!able || role) && (
                      <span className="block truncate text-[13px] leading-[18px] text-ink-secondary">{able ? role : t("permissions.cannotCoordinate")}</span>
                    )}
                  </span>
                  <span aria-hidden="true" className={cn("flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px]",
                    checked ? "border-ink" : "border-ink/30")}>
                    {checked && <span className="size-2 rounded-full bg-ink" />}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setChoosing(false)} className={cn(PILL, SECONDARY)}>{t("onboarding.back")}</button>
            <button type="button" data-chief-confirm="" disabled={!choice || leaving} onClick={() => choice && keep(choice)} className={cn(PILL, PRIMARY)}>
              {t("onboarding.chief.confirm")}
            </button>
          </div>
        </>
      ) : (
        <>
          <span ref={avatar} className="relative mx-auto mt-2.5 flex w-fit">
            {subject ? <BotAvatar bot={subject} size={AVATAR_SIZE} motion="arrive" /> : <MausAvatar color="chrome" size={AVATAR_SIZE} label={DEFAULT_BOT_NAME} />}
            <ChiefBadge />
          </span>
          <h2 id="chief-intro-title" className="mt-4 text-[17px] font-medium leading-6 tracking-[-0.008em] text-ink">
            {own ? t("onboarding.chief.meetTitle", { name: own.name }) : t("onboarding.chief.title")}
          </h2>
          <p className="mx-auto mt-1.5 max-w-[360px] text-[14px] leading-5 text-ink-secondary">{t("onboarding.chief.body")}</p>
          <div className="mt-6 grid grid-cols-2 gap-2">
            {own ? (
              <button type="button" data-primary="" onClick={() => keep(own)} className={cn(PILL, SECONDARY)}>
                {t("onboarding.chief.keep", { name: own.name })}
              </button>
            ) : (
              <button type="button" data-primary="" data-chief-create="" onClick={create} disabled={!maus} className={cn(PILL, SECONDARY)}>
                {t("onboarding.chief.create")}
              </button>
            )}
            <button
              type="button"
              data-chief-choose=""
              onClick={() => {
                setPicked(own?.id ?? null);
                setChoosing(true);
              }}
              disabled={choices.length === 0}
              className={cn(PILL, SECONDARY)}
            >
              {own ? t("onboarding.chief.chooseAnother") : t("onboarding.chief.choose")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
