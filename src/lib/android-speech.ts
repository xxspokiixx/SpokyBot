import { androidBridge } from "./android-bridge";

/** Native dictation on the phone.
 *
 *  The desktop app runs Apple's speech helper and hands the page `window.ogb.speechStart`,
 *  `speechStop` and two subscriptions. Android has its own recognizer, so the phone's shell exposes
 *  the same two calls and pushes each line back through `window.ombSpeech` (partial or final) and
 *  `window.ombSpeechEnd`. This installs that surface on `window.ogb` so the composer's microphone
 *  runs on the phone with no special case above it. */
type Line = { partial?: boolean; text?: string; error?: string };
type End = { code: number | null; reason?: string };

const listeners = { transcript: new Set<(line: Line) => void>(), end: new Set<(info: End) => void>() };

let installed = false;

/** Called by the shell's `evaluateJavascript`; a no-op on every other platform. */
function receiveText(partial: boolean, text: string) {
  for (const listener of listeners.transcript) listener({ partial, text });
}

function receiveEnd(code: number, reason: string | null) {
  for (const listener of listeners.end) listener({ code, reason: reason ?? undefined });
}

export function installAndroidSpeech(): void {
  if (installed || typeof window === "undefined") return;
  const bridge = androidBridge();
  if (!bridge?.speechStart || !bridge.speechStop) return;
  installed = true;

  const host = window as Window & { ogb?: Record<string, unknown>; ombSpeech?: unknown; ombSpeechEnd?: unknown };
  host.ombSpeech = receiveText;
  host.ombSpeechEnd = receiveEnd;

  host.ogb = {
    // The shell answers the rest of this type through its own page; only speech is added here.
    ...(host.ogb ?? { platform: "android" }),
    speechStart: async () => { bridge.speechStart!(); },
    speechStop: async () => { bridge.speechStop!(); },
    onSpeechTranscript: (callback: (line: Line) => void) => {
      listeners.transcript.add(callback);
      return () => { listeners.transcript.delete(callback); };
    },
    onSpeechEnd: (callback: (info: End) => void) => {
      listeners.end.add(callback);
      return () => { listeners.end.delete(callback); };
    },
  } as Window["ogb"];
}
