// An app in the transcript (message kind "app"): a bot's own page
// (show_html) or an MCP server's UI, running in a sandboxed frame inside a
// card the host draws (docs/superpowers/specs/2026-10-14-chat-apps-design.md).
//
// The row owns everything outside the frame: the header, the info panel, the
// Allow bar, the strips, and the box that keeps the frame's height while it
// is not running. It takes a slot in the window's pool (app-pool.ts) when it
// comes into view, fetches its document, and mounts AppFrame. update_html
// (a new `doc` or `rev`) and Reload tear the frame down first, then mount the
// new one at the same height.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useStore, type Message } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { AppDocument, AppPayload } from "../../../shared/app";
import { appBlockedText } from "../../../shared/app";
import { APP_FRAME_LIMITS } from "../../../shared/app-frame/bridge";
import { AppDocumentError, fetchAppDocument, type AppFetchFailure } from "./app-api";
import { APP_POOL_LIMITS, useAppPoolSlot, type AppPool } from "./app-pool";
import { AppAllowBar, AppHeader, AppInfo, AppOpenButton, AppPlaceholder, AppStrip, APP_SURFACE, type AllowDecision } from "./AppChrome";
import { AppFrame, type AppFrameHandle, type AppFrameProblem } from "./AppFrame";

/** The message column, up to 760px. */
const WIDTH = "max-w-[760px]";
/** The Allow bar answers "declined" after this long. */
const ALLOW_TIMEOUT_MS = APP_FRAME_LIMITS.allowTimeoutMs;
/** A fetched document is reused for this long when a frame remounts after
 * the pool took its slot; Reload always fetches again. */
const DOC_REUSE_MS = 60_000;

/** The last height each (row, revision) reported, so a remount starts there. */
const heights = new Map<string, number>();
/** Documents fetched lately, by row and content id. */
const docs = new Map<string, { doc: AppDocument; at: number }>();

/** Forget remembered heights and documents (tests, and a signed-out window). */
export function forgetAppRows(): void {
  heights.clear();
  docs.clear();
}

function rememberDoc(key: string, doc: AppDocument) {
  docs.set(key, { doc, at: Date.now() });
  // a handful is plenty: they are only for a frame that comes straight back
  while (docs.size > 8) docs.delete(docs.keys().next().value!);
}

function isAppPayload(value: unknown): value is AppPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<AppPayload>;
  return typeof payload.title === "string" && (payload.source === "html" || payload.source === "mcp") && typeof payload.doc === "string";
}

/** Whether this row is among its thread's newest app rows, which mount by
 * themselves; older ones wait for "Open app". */
function useAutoMount(botId: string, threadId: string | undefined, messageId: string): boolean {
  const { state } = useStore();
  const bot = state?.bots?.find((candidate) => candidate.id === botId);
  const messages = bot && (!threadId || bot.threadId === threadId) ? bot.messages : undefined;
  const newest = useMemo(() => {
    if (!messages) return null;
    const ids = messages.filter((message) => message.kind === "app").map((message) => message.id);
    return new Set(ids.slice(-APP_POOL_LIMITS.autoMountNewest));
  }, [messages]);
  // a row the store does not hold (a test page, a row just arrived) is new
  return !newest || newest.has(messageId) || !messages?.some((message) => message.id === messageId);
}

export function AppMessage({ botId, botName, threadId, message, pool }: {
  botId: string;
  botName: string;
  threadId?: string;
  message: Message;
  pool?: AppPool;
}) {
  const payload = message.app;
  // a row with no app to draw still says what it said
  if (!isAppPayload(payload) || !threadId) {
    return message.text
      ? <div className="chat-text w-fit max-w-[min(42rem,78%)] rounded-2xl bg-card px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-ink">{message.text}</div>
      : null;
  }
  return <AppRow botId={botId} botName={botName} threadId={threadId} message={message} payload={payload} pool={pool} />;
}

interface AllowAsk {
  id: number;
  tool: string;
  decide(decision: AllowDecision): void;
}

type Loaded =
  | { key: string; doc: AppDocument; failure?: undefined }
  | { key: string; doc?: undefined; failure: AppFetchFailure };

function AppRow({ botId, botName, threadId, message, payload, pool }: {
  botId: string;
  botName: string;
  threadId: string;
  message: Message;
  payload: AppPayload;
  pool?: AppPool;
}) {
  const { dispatch } = useStore();
  const uid = useId();
  const rev = payload.rev ?? 0;
  const bordered = payload.border !== false;
  /** What a mount fetches: the stored document of this revision. */
  const docKey = payload.doc ? `${message.id}:${payload.doc}:${rev}` : "";
  // a remount starts where the frame last was; a new revision, where the last one was
  const [height, setHeight] = useState(() => heights.get(`${message.id}:${rev}`) ?? heights.get(`${message.id}:${rev - 1}`) ?? payload.height ?? APP_FRAME_LIMITS.defaultHeight);
  const [infoOpen, setInfoOpen] = useState(false);
  /** The View asked to close: the frame folds to its header until reopened. */
  const [collapsed, setCollapsed] = useState(false);
  /** Bumped by Reload: fetch the document again and mount a new frame. */
  const [reload, setReload] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [fetching, setFetching] = useState(false);
  const [problem, setProblem] = useState<AppFrameProblem | null>(null);
  const [asks, setAsks] = useState<AllowAsk[]>([]);
  const askSeq = useRef(0);
  const frame = useRef<AppFrameHandle | null>(null);
  const row = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const auto = useAutoMount(botId, threadId, message.id) && !collapsed && Boolean(docKey);
  const evict = useCallback(async () => {
    await frame.current?.teardown();
    frame.current = null;
  }, []);
  const slot = useAppPoolSlot({ key: `${threadId}:${message.id}`, target: row, auto, evict, ...(pool ? { pool } : {}) });

  // The document of this revision, fetched once the row holds a slot.
  const wanted = slot.live && docKey ? `${docKey}:${reload}` : "";
  useEffect(() => {
    if (!wanted) return;
    const controller = new AbortController();
    setFetching(true);
    const reuse = reload === 0 ? docs.get(docKey) : undefined;
    const fetched = reuse && Date.now() - reuse.at < DOC_REUSE_MS
      ? Promise.resolve(reuse.doc)
      : fetchAppDocument(threadId, message.id, controller.signal).then((doc) => { rememberDoc(docKey, doc); return doc; });
    void fetched.then(
      async (doc) => {
        // a frame of the previous revision goes first, and is asked to
        if (frame.current) await evict();
        if (!controller.signal.aborted && mounted.current) {
          setProblem(null);
          setFetching(false);
          setLoaded({ key: wanted, doc });
        }
      },
      (error: unknown) => {
        if (controller.signal.aborted || !mounted.current) return;
        setFetching(false);
        setLoaded({ key: wanted, failure: error instanceof AppDocumentError ? error.failure : { offline: true } });
      },
    );
    return () => {
      controller.abort();
      setFetching(false);
    };
  }, [wanted, docKey, reload, threadId, message.id, evict]);

  // The pool took the slot, or the row folded: drop what was loaded so the
  // next mount fetches what is current.
  useEffect(() => {
    if (!slot.live) setLoaded(null);
  }, [slot.live]);

  const onHeight = useCallback((next: number) => {
    heights.set(`${message.id}:${rev}`, next);
    if (mounted.current) setHeight(next);
  }, [message.id, rev]);

  /** Open Allow questions, oldest first; the bar shows the first. */
  const asksNow = useRef<AllowAsk[]>([]);
  const askAllow = useCallback((tool: string) => new Promise<AllowDecision>((resolve) => {
    const id = ++askSeq.current;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const decide = (decision: AllowDecision) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      asksNow.current = asksNow.current.filter((ask) => ask.id !== id);
      if (mounted.current) setAsks(asksNow.current);
      resolve(decision);
    };
    timer = setTimeout(() => decide("deny"), ALLOW_TIMEOUT_MS);
    asksNow.current = [...asksNow.current, { id, tool, decide }];
    setAsks(asksNow.current);
  }), []);

  // The document running now. A new revision keeps the old frame until its
  // own document is here; the fetch tears the old one down first.
  const current = slot.live ? loaded?.doc : undefined;
  // A frame that goes away (or a row that does) takes its open questions with it.
  // decide() replaces the list rather than changing it, so this walks a stable one
  const denyAll = useCallback(() => { for (const ask of asksNow.current) ask.decide("deny"); }, []);
  useEffect(() => { if (!current) denyAll(); }, [current, denyAll]);
  useEffect(() => denyAll, [denyAll]);

  const reloadNow = () => {
    setProblem(null);
    setCollapsed(false);
    setReload((count) => count + 1);
    if (!slot.live) slot.open();
  };

  // The View asked to be closed: it is asked to tear down first, then folds.
  const { close } = slot;
  const onTeardownRequested = useCallback(() => {
    void evict().then(() => {
      if (!mounted.current) return;
      setCollapsed(true);
      close();
    });
  }, [evict, close]);

  const origin = payload.source === "mcp"
    ? t("app.origin.mcp", { server: payload.mcp?.serverTitle || payload.mcp?.server || payload.title })
    : t("app.origin.page", { bot: botName });
  const serverName = payload.mcp?.serverTitle || payload.mcp?.server;
  const signIn = () => dispatch({ type: "togglePlugins", open: true, surface: "mcp" });

  // What the strip says: a refusal the frame just met, else the document's
  // own reason, else the row's.
  const strip = (() => {
    if (problem?.kind === "sign-in") return { text: t("app.strip.signIn", { server: serverName || problem.server }), action: { label: t("app.strip.signInAction"), onClick: signIn } };
    if (problem?.kind === "offline") return { text: t("app.strip.offline"), action: { label: t("app.strip.retry"), onClick: reloadNow } };
    if (problem?.kind === "blocked") return { text: problem.text || appBlockedText(problem.reason, serverName) };
    if (loaded?.failure) {
      return loaded.failure.offline
        ? { text: t("app.strip.offline"), action: { label: t("app.strip.retry"), onClick: reloadNow } }
        : { text: loaded.failure.error };
    }
    const blocked = current?.blocked;
    if (blocked) return blocked.reason === "signed-out" ? { text: blocked.text, action: { label: t("app.strip.signInAction"), onClick: signIn } } : { text: blocked.text };
    if (payload.blocked) return { text: appBlockedText(payload.blocked, serverName) };
    return null;
  })();

  const noPage = !docKey || Boolean(loaded?.failure && !loaded.failure.offline);
  const state = collapsed ? "collapsed" : current ? "live" : noPage ? "unavailable" : slot.live ? "loading" : "idle";
  const ask = asks[0];
  const infoId = `${uid}-info`;

  const body = collapsed ? null : noPage ? (
    // nothing to run: the row's own words, as its readable fallback
    message.text ? <div dir="auto" className={cn("line-clamp-6 whitespace-pre-wrap text-[13px] leading-[18px] text-ink-secondary", bordered ? "px-4 pb-3" : "pb-2")}>{message.text}</div> : null
  ) : (
    <div data-app-box className={cn("relative w-full", bordered && "border-t border-ink/[0.08]")} style={{ height }}>
      {current ? (
        <AppFrame
          key={loaded!.key}
          doc={current}
          botId={botId}
          threadId={threadId}
          title={payload.title}
          height={height}
          handle={frame}
          onHeight={onHeight}
          askAllow={askAllow}
          onProblem={setProblem}
          onTeardownRequested={onTeardownRequested}
        />
      ) : (
        <AppPlaceholder height={height} loading={slot.live} open={slot.live ? undefined : reloadNow} />
      )}
    </div>
  );

  return (
    <div
      ref={row}
      role="group"
      aria-label={t("app.aria.row", { title: payload.title })}
      data-app={message.id}
      data-app-state={state}
      data-app-source={payload.source}
      className={cn("w-full text-start", WIDTH)}
    >
      <div className={cn(bordered ? APP_SURFACE : "w-full")}>
        <AppHeader
          title={payload.title}
          origin={origin}
          infoId={infoId}
          infoOpen={infoOpen}
          onInfo={() => setInfoOpen((open) => !open)}
          onReload={docKey ? reloadNow : undefined}
          reloading={fetching && Boolean(current)}
          bordered={bordered}
        />
        {infoOpen && <AppInfo id={infoId} network={payload.network ?? { connect: [], resources: [] }} bytes={payload.bytes ?? 0} bordered={bordered} />}
        {collapsed && (
          <div className={cn("flex", bordered ? "px-4 pb-3.5" : "pb-2")}>
            <AppOpenButton label={t("app.openAgain")} onClick={reloadNow} />
          </div>
        )}
        {body}
        {ask && current && <AppAllowBar title={payload.title} tool={ask.tool} onDecide={(decision) => ask.decide(decision)} bordered={bordered} />}
        {strip && <AppStrip text={strip.text} action={strip.action} bordered={bordered} />}
      </div>
    </div>
  );
}
