import { useCallback, useEffect, useRef, useState } from "react";
import { Clipboard, Loader2, Maximize, Minimize, RefreshCw, ZoomIn, ZoomOut } from "lucide-react";
import type RFB from "@novnc/novnc";
import { cn } from "@/lib/cn";
import { connectDesktop } from "@/lib/desktop-connection";
import { t } from "@/lib/i18n";
import { SoftKeyboardButton, SoftKeyboardField, useSoftKeyboard, useTapRaisesKeyboard } from "./SoftKeyboard";

type Connection = "connecting" | "connected" | "disconnected";
type Panel = "clipboard" | null;

/** The phone's own Linux desktop, shown inside the Screen panel through the app's desktop proxy. */
export function LocalDesktopPreview({ target, name }: { target: string; name: string }) {
  const screen = useRef<HTMLDivElement>(null);
  const rfb = useRef<RFB | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [attempt, setAttempt] = useState(0);
  const retried = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const [panel, setPanel] = useState<Panel>(null);
  const [zoomed, setZoomed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [clipboard, setClipboard] = useState("");
  const label = t("computer.viewerTitle", { name });
  const shell = useRef<HTMLDivElement>(null);

  const applyZoom = useCallback((on: boolean) => {
    const client = rfb.current;
    if (!client) return;
    client.scaleViewport = !on;
    setZoomed(on);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let client: RFB | undefined;
    setConnection("connecting");
    void connectDesktop(screen.current!, target, {
      signal: controller.signal,
      events: {
        connected: () => setConnection("connected"),
        disconnected: () => {
          if (controller.signal.aborted) return;
          setConnection("disconnected");
          // The phone's own desktop answers its first RFB connection slowly, because websockify
          // and x11vnc both run under proot; the retry lands on a warm desktop. One silent retry
          // replaces the "reconnect" the person would otherwise have to find and press.
          if (retried.current) return;
          retried.current = true;
          window.setTimeout(() => { if (mounted.current) setAttempt((value) => value + 1); }, 750);
        },
        clipboard: (value) => setClipboard(value),
      },
    }).then((connected) => {
      if (controller.signal.aborted) return connected.disconnect();
      client = connected;
      rfb.current = connected;
      connected.scaleViewport = true;
    }, () => { if (!controller.signal.aborted) setConnection("disconnected"); });
    return () => {
      controller.abort();
      client?.disconnect();
      if (rfb.current === client) rfb.current = null;
    };
  }, [target, attempt]);

  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setExpanded(false); };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = async () => {
    // A WebView may refuse the Fullscreen API, so the overlay is the contract and the native
    // call only widens it when the runtime allows it.
    const next = !expanded;
    setExpanded(next);
    const node = shell.current;
    if (!node) return;
    try {
      if (next && node.requestFullscreen) await node.requestFullscreen();
      else if (document.fullscreenElement) await document.exitFullscreen();
    } catch { /* the overlay already covers the app */ }
  };

  const connected = connection === "connected";
  const icon = "flex size-9 items-center justify-center rounded-lg bg-black/60 text-white backdrop-blur focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40";
  const keyboard = useSoftKeyboard(() => (connection === "connected" ? rfb.current : null));
  const tapKeyboard = useTapRaisesKeyboard(() => connection === "connected", keyboard.raise);

  return (
    <div
      ref={shell}
      data-local-desktop
      data-state={connection}
      className={cn(expanded ? "fixed inset-0 z-80 flex flex-col bg-app" : "absolute inset-0")}
      onKeyDown={(event) => { if (expanded && event.key === "Escape" && !(event.target instanceof HTMLTextAreaElement)) setExpanded(false); }}
    >
      {expanded && (
        <div className="relative z-10 flex shrink-0 items-center gap-2 border-b border-hairline/40 bg-panel px-3 py-2">
          <span className="min-w-0 truncate text-[12px] font-medium text-ink">{label}</span>
          <button type="button" className="ml-auto flex size-9 items-center justify-center rounded-lg bg-control text-ink" title={t("desktopViewer.exitFullscreen")} aria-label={t("desktopViewer.exitFullscreen")} onClick={() => void toggleFullscreen()}>
            <Minimize size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className={cn("relative overflow-hidden", expanded ? "min-h-0 flex-1" : "absolute inset-0")}>
      <div
        ref={screen}
        role="application"
        aria-label={label}
        className="absolute inset-0"
        {...tapKeyboard}
      />
      {connection !== "connected" && (
        <div role="status" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-[12px] text-ink-secondary">
          {connection === "connecting" && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
          {t(connection === "connecting" ? "desktopViewer.connecting" : "desktopViewer.disconnected")}
        </div>
      )}
      </div>

      <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5">
        <SoftKeyboardField keyboard={keyboard} />
        <SoftKeyboardButton keyboard={keyboard} className={cn(icon, "disabled:opacity-40")} />
        <button type="button" className={icon} disabled={!connected} title={t("desktopViewer.clipboard")} aria-label={t("desktopViewer.clipboard")} aria-pressed={panel === "clipboard"} onClick={() => setPanel(panel === "clipboard" ? null : "clipboard")}>
          <Clipboard size={16} aria-hidden="true" />
        </button>
        <button type="button" className={icon} disabled={!connected} title={t(zoomed ? "canvas.zoomOut" : "canvas.zoomIn")} aria-label={t(zoomed ? "canvas.zoomOut" : "canvas.zoomIn")} aria-pressed={zoomed} onClick={() => applyZoom(!zoomed)}>
          {zoomed ? <ZoomOut size={16} aria-hidden="true" /> : <ZoomIn size={16} aria-hidden="true" />}
        </button>
        <button type="button" className={icon} title={t(expanded ? "desktopViewer.exitFullscreen" : "desktopViewer.fullscreen")} aria-label={t(expanded ? "desktopViewer.exitFullscreen" : "desktopViewer.fullscreen")} aria-pressed={expanded} onClick={() => void toggleFullscreen()}>
          {expanded ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />}
        </button>
        {connection === "disconnected" && (
          <button type="button" className={icon} title={t("desktopViewer.reconnect")} aria-label={t("desktopViewer.reconnect")} onClick={() => setAttempt((value) => value + 1)}>
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {panel === "clipboard" && (
        <form
          className={cn("absolute inset-x-2 z-10 rounded-xl border border-hairline bg-panel/95 p-3 shadow-2xl backdrop-blur", expanded ? "bottom-16" : "bottom-14")}
          onSubmit={(event) => {
            event.preventDefault();
            if (!connected || !clipboard) return;
            rfb.current?.clipboardPasteFrom(clipboard);
            setPanel(null);
          }}
        >
          <label className="mb-2 block text-[11px] text-ink-secondary" htmlFor="local-desktop-text">
            {t("desktopViewer.clipboardHint")}
          </label>
          <textarea
            id="local-desktop-text"
            rows={3}
            value={clipboard}
            disabled={!connected}
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setClipboard(event.target.value)}
            className="w-full resize-none rounded-lg border border-hairline bg-inset p-2 text-[13px] text-ink outline-none focus:border-focus"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button type="submit" disabled={!connected || !clipboard} className="min-h-9 rounded-lg bg-accent px-3 text-[12px] font-medium text-accent-ink disabled:opacity-40">
              <Clipboard size={14} aria-hidden="true" className="mr-1.5 inline" />{t("desktopViewer.send")}
            </button>
            <button type="button" className="ml-auto min-h-9 rounded-lg px-3 text-[12px] text-ink-secondary" onClick={() => setPanel(null)}>{t("desktopViewer.closePanel")}</button>
          </div>
        </form>
      )}
    </div>
  );
}
