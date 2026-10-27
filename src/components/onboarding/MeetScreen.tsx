import { useEffect, useRef, useState } from "react";
import { ArrowUp, Plus } from "lucide-react";
import { BotAvatar, MausAvatar } from "@/components/Avatar";
import { usePrefersReducedMotion } from "@/components/mascot-clock";
import { brand } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { DEFAULT_BOT_NAME, myDefaultBot, useViewerEmail } from "@/lib/default-bot";
import { t } from "@/lib/i18n";
import { aiWorks } from "@/lib/onboarding";
import type { MausState } from "@/lib/mascot";
import type { LocaleKey } from "@/locales";
import { useStore } from "@/state/store";
import { ConnectAi } from "./ConnectAi";
import { useWelcomeAi } from "./welcome-ai";

const MASCOT_SIZE = 72;

/** What the composer on the first screen types by itself, one after another. */
export const DEMO_ASKS: readonly LocaleKey[] = [
  "onboarding.meet.ask.inbox", "onboarding.meet.ask.replies", "onboarding.meet.ask.week", "onboarding.meet.ask.price",
];

const START_MS = 700;
const KEY_MS = 34;
const PAUSE_MS = 110;
const HOLD_MS = 2_200;
const SEND_MS = 280;

const askChars = (ask: number) => Array.from(t(DEMO_ASKS[ask % DEMO_ASKS.length]!));
/** Each ask starts with its first word already in, so the composer is never seen empty. */
const head = (chars: readonly string[]) => (chars.includes(" ") ? chars.indexOf(" ") + 1 : Math.min(3, chars.length));

/** The ask being typed and how far: one character at a time, held, sent, then the next. Reduced motion shows the first,
 * whole and still. */
function useTypedAsk(reduced: boolean): { text: string; sent: boolean; typing: boolean } {
  const [state, setState] = useState(() => ({ ask: 0, length: head(askChars(0)), sent: false, fresh: true }));
  const full = askChars(state.ask);
  const shown = reduced ? full.length : Math.min(state.length, full.length);
  useEffect(() => {
    if (reduced) return;
    const chars = askChars(state.ask);
    const finished = state.length >= chars.length;
    const last = chars[state.length - 1];
    const wait = state.fresh ? START_MS : state.sent ? SEND_MS : finished ? HOLD_MS : last === " " || last === "," ? PAUSE_MS : KEY_MS;
    const timer = setTimeout(() => setState((now) => now.sent
      ? { ask: now.ask + 1, length: head(askChars(now.ask + 1)), sent: false, fresh: false }
      : finished ? { ...now, sent: true, fresh: false } : { ...now, length: now.length + 1, fresh: false }), wait);
    return () => clearTimeout(timer);
  }, [reduced, state]);
  return { text: full.slice(0, shown).join(""), sent: state.sent, typing: !reduced && shown < full.length };
}

function DemoComposer({ reduced, onTyping }: { reduced: boolean; onTyping: (typing: boolean) => void }) {
  const { text, sent, typing } = useTypedAsk(reduced);
  const line = useRef<HTMLDivElement>(null);
  useEffect(() => onTyping(typing), [typing, onTyping]);
  useEffect(() => {
    if (line.current) line.current.scrollLeft = line.current.scrollWidth;
  }, [text]);
  return (
    <div aria-hidden="true" data-demo-composer="" className="w-[420px] max-w-full select-none rounded-[18px] border-[0.5px] border-ink/[0.12] bg-composer px-2 pb-1.5 pt-2.5 text-left shadow-[0_2px_8px_-1px_rgb(0_0_0/0.05),0_1px_2px_rgb(0_0_0/0.03)]">
      <div ref={line} className="overflow-hidden whitespace-nowrap px-2.5 text-[15px] leading-5 text-ink">
        <span className={cn("transition-[opacity,transform] duration-200 ease-out", sent && "inline-block -translate-y-1 opacity-0")}>{text}</span>
        <span className={cn("ml-px inline-block h-[17px] w-[1.5px] translate-y-[3px] bg-ink", !typing && !sent && "animate-caret", sent && "opacity-0")} />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="flex size-7 items-center justify-center rounded-full bg-ink/[0.07] text-ink-secondary"><Plus size={16} /></span>
        <span className={cn("flex size-7 items-center justify-center rounded-full transition-colors duration-200",
          text && !sent ? "bg-ink text-app" : "bg-ink/[0.12] text-ink-tertiary")}
        ><ArrowUp size={16} strokeWidth={2.2} /></span>
      </div>
    </div>
  );
}

/** The first run's first screen: the app's name, its mascot and a composer typing a few asks by itself, then Next. With
 * no AI working yet it also holds the one thing to do before chatting: connecting one, which Later leaves for after. */
export function MeetScreen({ hosted, onNext }: { hosted: boolean; onNext: () => void }) {
  const { state } = useStore();
  const reduced = usePrefersReducedMotion();
  const maus = myDefaultBot(state.bots, useViewerEmail());
  // An AI counts once it answered a test message (or cannot be sent one); OpenCode's free model never does.
  const tested = useWelcomeAi(state.instances, !hosted);
  const ready = aiWorks(tested);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!hosted && state.instances.length > 0 && !ready && tested?.state !== "testing") setAsking(true);
  }, [hosted, state.instances.length, ready, tested?.state]);
  const [typing, setTyping] = useState(false);
  const [motion, setMotion] = useState<{ kind: "arrive" | "success"; key: number }>({ kind: "arrive", key: 0 });
  const connectedOnce = useRef(false);
  useEffect(() => {
    if (!asking || !ready || connectedOnce.current) return;
    connectedOnce.current = true;
    setMotion((now) => ({ kind: "success", key: now.key + 1 }));
  }, [asking, ready]);

  const logo = brand().logo;
  const face: MausState = asking && ready ? "proud" : typing ? "listening" : "happy";
  const blocked = asking && !ready;
  return (
    <div className="flex min-h-full w-full flex-col items-center px-4 text-center">
      <div className="min-h-4 grow-[1.34]" />
      <h1 id="welcome-title" className="text-[28px] font-light leading-[34px] tracking-[-0.015em] text-ink">{t("onboarding.meet.title", { app: brand().name })}</h1>
      <div className="min-h-4 grow" />
      <span className="flex shrink-0" style={{ width: MASCOT_SIZE, height: MASCOT_SIZE }}>
        {logo ? (
          <img src={logo} alt="" width={MASCOT_SIZE} height={MASCOT_SIZE} className="size-full object-contain" />
        ) : maus ? (
          <BotAvatar bot={maus} size={MASCOT_SIZE} state={face} motion={motion.kind} motionKey={motion.key} gaze={typing ? { x: 0, y: 0.55 } : undefined} />
        ) : (
          <MausAvatar color="chrome" size={MASCOT_SIZE} state={face} motion={motion.kind} motionKey={motion.key} label={DEFAULT_BOT_NAME} />
        )}
      </span>
      <div className="h-8 shrink-0" />
      <DemoComposer reduced={reduced} onTyping={setTyping} />
      {hosted && <p className="mt-6 max-w-[420px] text-[14px] leading-relaxed text-ink-secondary">{t("onboarding.hosted.intro")}</p>}
      {asking && (
        <div className="mt-8 w-[440px] max-w-full">
          <ConnectAi hosted={hosted} tested={tested} />
        </div>
      )}
      <div className="min-h-4 grow-[1.06]" />
      <button
        type="button"
        data-primary=""
        onClick={onNext}
        disabled={blocked}
        className="h-9 w-[288px] max-w-full shrink-0 rounded-full bg-ink px-4 text-[14px] font-medium text-app transition-[transform,background-color,color] duration-150 hover:bg-ink/90 active:scale-[0.98] disabled:bg-ink/[0.12] disabled:text-ink-tertiary disabled:active:scale-100"
      >
        {t("onboarding.meet.next")}
      </button>
      {blocked && (
        <button type="button" data-welcome-later="" onClick={onNext}
          className="mt-3 rounded-full px-3 py-1 text-[13px] text-ink-secondary transition-colors hover:text-ink">
          {t("onboarding.meet.later")}
        </button>
      )}
      <div className="min-h-4 grow-[1.54]" />
    </div>
  );
}
