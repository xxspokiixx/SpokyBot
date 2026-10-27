import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { setEmailGateDone, track } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { beatsFor, completionPatch, firstRunPatch, markWelcomeFinished, resumeBeat, showWelcome, type BeatId } from "@/lib/onboarding";
import { clearWelcomeDraft, readWelcomeDraft, saveWelcomeDraft } from "@/lib/welcome-draft";
import { api, useStore } from "@/state/store";
import { ChiefIntro } from "./ChiefIntro";
import { MeetScreen } from "./MeetScreen";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab and Shift+Tab stay inside `root`, the way a modal dialog keeps them. */
function trapTab(event: ReactKeyboardEvent<HTMLElement>, root: HTMLElement | null): void {
  if (event.key !== "Tab" || !root) return;
  const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
  if (!focusable.length) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** The first run: two screens, then the chat. Meeting the app (with an AI to connect when none works), then the Chief of
 * Staff over the app itself. Its end is the chat with the bot chosen there (`onDone`). */
export function WelcomeFlow({
  onDone,
  replay = false,
  initialBeat,
  embedded = false,
  hosted = false,
}: {
  onDone: (botId: string | null) => void;
  replay?: boolean;
  initialBeat?: BeatId;
  embedded?: boolean;
  hosted?: boolean;
}) {
  const { state, dispatch } = useStore();
  // A first run keeps its screen in this browser, so a reload resumes it; a replay starts over. A hosted place's
  // browser may hold another person's draft.
  const keepsDraft = !replay && !embedded && !hosted;
  const beats = beatsFor({ hosted });
  const [beat, setBeat] = useState<BeatId>(() => resumeBeat(beats, initialBeat ?? (keepsDraft ? readWelcomeDraft()?.beat : undefined)));
  const root = useRef<HTMLDivElement>(null);
  const finishing = useRef(false);
  const record = useRef(state.config?.onboarding);
  record.current = state.config?.onboarding;

  useEffect(() => {
    track("onboarding_step", { step: beat, replay });
    if (keepsDraft && !finishing.current) saveWelcomeDraft({ beat });
  }, [beat, replay, keepsDraft]);

  // A Cloud sheet opened over the welcome never switches the window away from it (CloudAddDialog).
  useEffect(() => (embedded ? undefined : showWelcome()), [embedded]);

  const finish = useCallback(
    async (reason: "completed" | "skipped", botId: string | null) => {
      if (finishing.current) return;
      finishing.current = true;
      track("onboarding_completed", { reason, at: beat, replay });
      setEmailGateDone("submitted");
      if (!replay && !embedded) markWelcomeFinished();
      if (keepsDraft) clearWelcomeDraft();
      onDone(botId);
      try {
        const patch = replay ? completionPatch() : firstRunPatch(record.current);
        const config = await api("/api/config", { method: "PUT", body: JSON.stringify(patch), signal: AbortSignal.timeout(10_000) });
        dispatch({ type: "configStatus", config });
      } catch {
      }
    },
    [beat, dispatch, onDone, replay, embedded, keepsDraft],
  );

  const toChief = beats.includes("chief");
  const next = useCallback(() => {
    if (finishing.current) return;
    if (toChief) setBeat("chief");
    else void finish("completed", null);
  }, [toChief, finish]);

  useEffect(() => {
    if (beat === "meet") root.current?.focus({ preventScroll: true });
  }, [beat]);

  // Escape moves on as Later does; Enter on the screen itself presses Next while it can be pressed.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (beat === "meet" && event.key === "Escape") {
      event.preventDefault();
      next();
      return;
    }
    if (beat === "meet" && event.key === "Enter" && event.target === root.current) {
      event.preventDefault();
      root.current.querySelector<HTMLButtonElement>("[data-primary]:not([disabled])")?.click();
      return;
    }
    trapTab(event, root.current);
  };

  const chief = beat === "chief";
  return (
    <div
      ref={root}
      role={chief ? undefined : "dialog"}
      aria-modal={chief ? undefined : true}
      aria-labelledby={chief ? undefined : "welcome-title"}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-welcome={beat}
      className={cn(
        "welcome-screen flex outline-none",
        embedded ? "relative h-full w-full" : "fixed inset-0 z-50",
        chief ? "welcome-scrim items-center justify-center p-4" : "overflow-y-auto bg-app",
      )}
    >
      {chief ? (
        <ChiefIntro replay={replay} onDone={(botId) => void finish("completed", botId)} />
      ) : (
        <MeetScreen hosted={hosted} onNext={next} />
      )}
    </div>
  );
}
