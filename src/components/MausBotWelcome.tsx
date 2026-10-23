import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Crown, Sparkles, Wand2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { emailGateDone } from "@/lib/analytics";
import { DEFAULT_BOT_NAME, myDefaultBot, useViewerEmail } from "@/lib/default-bot";
import { colorSwatch, MAUS_COLOR_LABEL, MAUS_COLOR_NAMES, type MausColor } from "@/lib/mascot";
import { welcomeDue, type WelcomeViewer } from "@/lib/onboarding";
import { currentStep } from "@/lib/guided-tour";
import { useAdvancedMode } from "@/lib/interface-mode";
import { useStore, type Bot } from "@/state/store";
import { MASCOT_BODIES, MASCOT_BODY_IDS, type MascotBodyId } from "../../shared/mascot-bodies";
import { BotAvatar, MausAvatar } from "./Avatar";
import { AvatarImageGenerator } from "./AvatarImageGenerator";
import { useAvatarImage } from "./avatar-editing";
import { usePrefersReducedMotion } from "./mascot-clock";

export interface WelcomeDraft { name: string; color: MausColor; mascotBody: MascotBodyId }

const FLY_MS = 560;

/** What either choice saves: the person's changes, and that they chose. Add puts MausBot at the top of the sidebar;
 * Not now turns "Show MausBot in the sidebar" off. */
export function welcomePatch(bot: Pick<Bot, "name" | "color" | "mascotBody">, draft: WelcomeDraft, add: boolean): Partial<Bot> {
  const name = draft.name.trim();
  return {
    ...(name && name !== bot.name ? { name } : {}),
    ...(draft.color !== bot.color ? { color: draft.color } : {}),
    ...(draft.mascotBody !== (bot.mascotBody ?? "cursor") ? { mascotBody: draft.mascotBody } : {}),
    welcomed: true,
    sidebarHidden: !add,
    ...(add ? { pinned: true } : {}),
  };
}

/** Once per person and place, never over the first-run welcome or its tour. */
export function mausBotWelcomeDue(input: { bot: Pick<Bot, "welcomed" | "hidden"> | undefined; onboardingDue: boolean; welcomeOpen: boolean; tourOpen: boolean }): boolean {
  return Boolean(input.bot && !input.bot.welcomed && !input.bot.hidden && !input.onboardingDue && !input.welcomeOpen && !input.tourOpen);
}

/** Moves a copy of the popup's avatar onto MausBot's sidebar row, then lets the row show it. */
function flyToSidebar(from: HTMLElement | null, botId: string): void {
  if (!from) return;
  const start = from.getBoundingClientRect();
  const land = () => {
    const row = document.querySelector<HTMLElement>(`[data-sidebar-bot-row="${CSS.escape(botId)}"]`);
    const target = row?.querySelector<HTMLElement>("svg, img") ?? row;
    if (!target) return;
    const end = target.getBoundingClientRect();
    const ghost = from.cloneNode(true) as HTMLElement;
    Object.assign(ghost.style, { position: "fixed", left: `${start.left}px`, top: `${start.top}px`, width: `${start.width}px`, height: `${start.height}px`, margin: "0", zIndex: "60", pointerEvents: "none", transformOrigin: "top left" });
    document.body.appendChild(ghost);
    const scale = end.width / Math.max(start.width, 1);
    const [dx, dy] = [end.left - start.left, end.top - start.top];
    // A shallow arc: up a little on the way, then down onto the row.
    const animation = ghost.animate([
      { transform: "translate(0, 0) scale(1)" },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 36}px) scale(${(1 + scale) / 2})`, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
    ], { duration: FLY_MS, easing: "cubic-bezier(0.45, 0, 0.25, 1)" });
    animation.onfinish = () => ghost.remove();
    animation.oncancel = () => ghost.remove();
  };
  requestAnimationFrame(() => requestAnimationFrame(land));
}

export function MausBotWelcome({ viewer }: { viewer: WelcomeViewer | null }) {
  const { state } = useStore();
  const bot = myDefaultBot(state.bots, useViewerEmail());
  const [closed, setClosed] = useState(false);
  const advanced = useAdvancedMode();
  const record = state.config?.onboarding;
  const touring = state.tourOpen || (Boolean(record?.completedAt) && currentStep(record, advanced) !== null);
  const onboardingDue = !viewer || welcomeDue(state.config, {
    remoteClient: window.ogb?.remoteClient?.active === true, legacyDone: emailGateDone(),
    hosted: viewer.hosted, canSave: viewer.canSave, cloudHome: viewer.cloudHome,
  });
  if (closed || !state.config || !mausBotWelcomeDue({ bot, onboardingDue, welcomeOpen: state.welcomeOpen, tourOpen: touring })) return null;
  return createPortal(<MausBotWelcomeCard bot={bot!} onClose={() => setClosed(true)} />, document.body);
}

export function MausBotWelcomeCard({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const { dispatch } = useStore();
  const reduced = usePrefersReducedMotion();
  const [draft, setDraft] = useState<WelcomeDraft>({ name: bot.name || DEFAULT_BOT_NAME, color: bot.color, mascotBody: (bot.mascotBody as MascotBodyId) ?? "cursor" });
  const avatarRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const image = useAvatarImage(bot, (patch) => dispatch({ type: "updateBot", botId: bot.id, patch }));
  const preview: Bot = { ...bot, name: draft.name.trim() || DEFAULT_BOT_NAME, color: draft.color, mascotBody: draft.mascotBody };
  const name = preview.name;
  useEffect(() => { nameRef.current?.focus(); }, []);

  const choose = (add: boolean) => {
    dispatch({ type: "updateBot", botId: bot.id, patch: welcomePatch(bot, draft, add) });
    if (add && !reduced) flyToSidebar(avatarRef.current, bot.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6" data-mausbot-welcome="">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mausbot-welcome-title"
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}
        className="animate-pop-in max-h-[calc(100dvh-48px)] w-full max-w-[460px] overflow-y-auto rounded-3xl border border-hairline/50 bg-panel p-6 shadow-2xl"
      >
        <div className="flex flex-col items-center text-center">
          <div ref={avatarRef} data-mausbot-welcome-avatar="" className="drop-shadow-[0_10px_24px_rgba(0,0,0,0.22)]">
            <BotAvatar bot={preview} size={104} label={name} motion="arrive" />
          </div>
          <h2 id="mausbot-welcome-title" className="mt-3 text-[20px] font-semibold text-ink">{t("mausbotWelcome.title", { name })}</h2>
          <ul className="mt-3 space-y-1.5 text-left text-[13.5px] leading-snug text-ink-secondary">
            {([[Sparkles, "mausbotWelcome.line.helper"], [BookOpen, "mausbotWelcome.line.knows"], [Wand2, "mausbotWelcome.line.setup"], [Crown, "mausbotWelcome.line.powers"]] as const).map(([Icon, key]) => (
              <li key={key} className="flex items-start gap-2.5"><Icon size={15} className="mt-0.5 shrink-0 text-ink-tertiary" aria-hidden="true" />{t(key)}</li>
            ))}
          </ul>
        </div>

        <div className="mt-5 space-y-3 rounded-2xl bg-ink/[0.03] p-3.5">
          <label className="block">
            <span className="text-[11.5px] font-medium uppercase tracking-wide text-ink-secondary">{t("onboarding.bot.name")}</span>
            <input
              ref={nameRef}
              value={draft.name}
              maxLength={100}
              data-mausbot-welcome-name=""
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              className="mt-1 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink focus:outline-none"
            />
          </label>
          <div>
            <span className="text-[11.5px] font-medium uppercase tracking-wide text-ink-secondary">{t("onboarding.bot.color")}</span>
            <div role="radiogroup" aria-label={t("onboarding.bot.color")} className="mt-1.5 flex flex-wrap gap-1.5">
              {MAUS_COLOR_NAMES.map((color) => (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={draft.color === color}
                  aria-label={t(MAUS_COLOR_LABEL[color])}
                  title={t(MAUS_COLOR_LABEL[color])}
                  data-mausbot-welcome-color={color}
                  onClick={() => setDraft({ ...draft, color })}
                  className={cn("size-6 rounded-full border-2 transition-transform hover:scale-110", draft.color === color ? "border-ink" : "border-transparent")}
                  style={{ background: colorSwatch(color) }}
                />
              ))}
            </div>
          </div>
          <div>
            <span className="text-[11.5px] font-medium uppercase tracking-wide text-ink-secondary">{t("mausbotWelcome.look")}</span>
            <div className="mt-1.5 grid grid-cols-5 gap-1">
              {MASCOT_BODY_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={draft.mascotBody === id}
                  aria-label={MASCOT_BODIES[id].name}
                  title={MASCOT_BODIES[id].name}
                  data-mausbot-welcome-body={id}
                  onClick={() => setDraft({ ...draft, mascotBody: id })}
                  className={cn("flex h-11 items-center justify-center rounded-xl", draft.mascotBody === id ? "bg-ink/[0.08] ring-[1.5px] ring-inset ring-ink/25" : "hover:bg-ink/[0.05]")}
                >
                  <MausAvatar color={draft.color} bodyId={id} size={30} animated={false} trackPointer={false} />
                </button>
              ))}
            </div>
          </div>
          <details>
            <summary className="flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-secondary hover:text-ink">
              <Sparkles size={14} aria-hidden="true" />{t("mausbotWelcome.generate")}
            </summary>
            <div className="mt-2">
              <AvatarImageGenerator botLabel={name} disabled={image.uploading} generating={image.generating} onGenerate={image.generate} onSavingChange={image.setSavingConnection} />
            </div>
          </details>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" data-mausbot-welcome-later="" onClick={() => choose(false)} title={t("mausbotWelcome.notNowHint", { name })}
            className="rounded-full px-3 py-2 text-[13px] text-ink-secondary hover:bg-raised-hover hover:text-ink">
            {t("mausbotWelcome.notNow")}
          </button>
          <button type="button" data-mausbot-welcome-add="" onClick={() => choose(true)}
            className="rounded-full bg-accent px-5 py-2.5 text-[14px] font-medium text-accent-ink hover:brightness-110">
            {t("mausbotWelcome.add", { name })}
          </button>
        </div>
      </div>
    </div>
  );
}
