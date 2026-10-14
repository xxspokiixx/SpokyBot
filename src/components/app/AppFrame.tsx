// One running app frame in a chat row: the sandboxed srcdoc iframe and the
// shared bridge router (app-frame-host.ts), with the desktop's answers to
// what a View asks for (docs/superpowers/specs/2026-10-14-chat-apps-design.md,
// "Desktop"):
//
//   tools/*, resources/*   the rpc route; a 409 asks the person in the Allow
//                          bar (only while they are using the app), a 401
//                          says sign in again, a 410 says the server is gone
//   ui/message             `appMessage` on the send route, after the bot's
//                          pending settings are saved, as a typed send is
//   ui/open-link           the system browser (the preload's openExternal)
//   ui/update-model-context  the context route
//
// The frame is created when this mounts and its document is set verbatim;
// a new document (update_html, Reload) is a new mount.
import { useLayoutEffect, useRef, type MutableRefObject } from "react";
import { appVersion, openExternalLink } from "@/lib/app-links";
import { useStore } from "@/state/store";
import type { AppBlockedReason, AppDocument } from "../../../shared/app";
import { RPC_HOST_REFUSED, type JsonRpcError } from "../../../shared/app-frame/bridge";
import { callAppRpc, newAppSendId, postAppContext, sendAppMessage } from "./app-api";
import { mountAppFrame } from "./app-frame-host";
import { appHostContext, appMaxHeight, appThemeContext } from "./app-host-context";
import type { AllowDecision } from "./AppChrome";

export interface AppFrameHandle {
  /** Ask the View to tear down (at most a second), then remove the frame. */
  teardown(): Promise<void>;
}

/** Something the row should say under the frame. */
export type AppFrameProblem =
  | { kind: "sign-in"; server: string }
  | { kind: "offline" }
  | { kind: "blocked"; reason: AppBlockedReason; text?: string };

export interface AppFrameProps {
  doc: AppDocument;
  botId: string;
  threadId: string;
  /** The frame's accessible name: the app's title. */
  title: string;
  height: number;
  /** Filled while the frame runs, for the pool and Reload. */
  handle: MutableRefObject<AppFrameHandle | null>;
  onHeight(height: number): void;
  /** The Allow bar: resolves with the person's answer (deny after 2 min). */
  askAllow(tool: string): Promise<AllowDecision>;
  onProblem(problem: AppFrameProblem | null): void;
  /** The View asked to be closed (ui/notifications/request-teardown). */
  onTeardownRequested(): void;
}

const refusal = (message: string): JsonRpcError => ({ code: RPC_HOST_REFUSED, message });

export function AppFrame(props: AppFrameProps) {
  const box = useRef<HTMLDivElement | null>(null);
  const { flushBotPatches } = useStore();
  // Callbacks change every render; the frame lives across renders.
  const latest = useRef({ ...props, flushBotPatches });
  latest.current = { ...props, flushBotPatches };
  const { doc, botId, threadId } = props;

  useLayoutEffect(() => {
    const container = box.current;
    if (!container) return;
    const messageId = doc.messageId;
    /** "Allow for this app": until this frame is torn down. */
    let allowAll = false;
    let maxHeight = appMaxHeight();
    const host = mountAppFrame({
      container,
      doc,
      title: latest.current.title,
      height: latest.current.height,
      hostContext: appHostContext({ width: container.clientWidth || 600, maxHeight }),
      hostVersion: appVersion(),
      ...(import.meta.env?.DEV ? { log: (params: unknown) => console.info("[app]", params) } : {}),
      adapter: {
        async callRpc(method, params, { engaged }) {
          let confirmed = allowAll;
          for (;;) {
            const outcome = await callAppRpc({ botId, threadId, messageId, method, params, confirmed });
            if (outcome.ok) return outcome.result;
            if (outcome.confirm && !confirmed) {
              // A write waits on the person only while they are using the app.
              if (!engaged) throw refusal("This needs the person to be using the app.");
              const decision = await latest.current.askAllow(outcome.confirm.title ?? outcome.confirm.tool);
              if (decision === "deny") throw refusal("The person declined.");
              if (decision === "always") allowAll = true;
              confirmed = true;
              continue;
            }
            if (outcome.signIn) {
              latest.current.onProblem({ kind: "sign-in", server: outcome.signIn.server });
              throw refusal("Sign-in needed");
            }
            if (outcome.blocked) latest.current.onProblem({ kind: "blocked", ...outcome.blocked });
            else if (outcome.status === 0) latest.current.onProblem({ kind: "offline" });
            throw outcome.error;
          }
        },
        async sendMessage(text) {
          // A bot setting just changed is saved before the message starts a turn.
          await latest.current.flushBotPatches(botId);
          await sendAppMessage({ botId, threadId, messageId, text, sendId: newAppSendId() });
        },
        openLink: (url) => openExternalLink(url),
        setContext: (update) => postAppContext({ botId, threadId, messageId, update }),
        resize: (height) => latest.current.onHeight(height),
        teardownRequested: () => latest.current.onTeardownRequested(),
      },
    });
    latest.current.handle.current = { teardown: () => host.teardown() };

    // Skin changes: the theme and the variables follow.
    const skin = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => host.contextChanged(appThemeContext()));
    skin?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-skin"] });
    // Width and window height: the container's size follows.
    let width = Math.round(container.clientWidth);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      timer = undefined;
      const nextWidth = Math.round(container.clientWidth);
      const nextMax = appMaxHeight();
      if (nextWidth <= 0 || (nextWidth === width && nextMax === maxHeight)) return;
      width = nextWidth;
      maxHeight = nextMax;
      host.contextChanged({ containerDimensions: { width, maxHeight } });
    };
    const later = () => { if (timer === undefined) timer = setTimeout(measure, 150); };
    const sized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(later);
    sized?.observe(container);
    window.addEventListener("resize", later);

    return () => {
      skin?.disconnect();
      sized?.disconnect();
      window.removeEventListener("resize", later);
      if (timer !== undefined) clearTimeout(timer);
      if (latest.current.handle.current) latest.current.handle.current = null;
      // The row is going: the frame waits out the View's teardown somewhere
      // hidden (the pool, Reload and update_html wait on teardown() first).
      host.retire();
    };
    // A new document is a new frame; nothing else remounts it.
  }, [doc, botId, threadId]);

  return <div ref={box} data-app-frame-box className="w-full" />;
}
