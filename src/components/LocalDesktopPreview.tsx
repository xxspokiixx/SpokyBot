import { useCallback, useEffect, useRef, useState } from "react";
import { Clipboard, Keyboard, Loader2, Maximize, Minimize, RefreshCw, Send, ZoomIn, ZoomOut } from "lucide-react";
import type RFB from "@novnc/novnc";
import { cn } from "@/lib/cn";
import { connectDesktop, typeOnDesktop } from "@/lib/desktop-connection";
import { t } from "@/lib/i18n";

type Connection = "connecting" | "connected" | "disconnected";
type Panel = "keyboard" | "clipboard" | null;

/** The phone's own Linux desktop, shown inside the Screen panel through the app's desktop proxy. */
export function LocalDesktopPreview({ target, name }: { target: string; name: string }) {
  const screen = useRef<HTMLDivElement>(null);
  const rfb = useRef<RFB | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [attempt, setAttempt] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [zoomed, setZoomed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState("");
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
        disconnected: () => { if (!controller.signal.aborted) setConnection("disconnected"); },
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

  return (
    <div
      ref={shell}
      data-local-desktop
      data-state={connection}
      className={cn(expanded ? "fixed inset-0 z-80 bg-app" : "absolute inset-0")}
      onKeyDown={(event) => { if (expanded && event.key === "Escape" && !(event.target instanceof HTMLTextAreaElement)) setExpanded(false); }}
    >
      <div ref={screen} role="application" aria-label={label} className="absolute inset-0" />
      {connection !== "connected" && (
        <div role="status" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-[12px] text-ink-secondary">
          {connection === "connecting" && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
          {t(connection === "connecting" ? "desktopViewer.connecting" : "desktopViewer.disconnected")}
        </div>
      )}

      {expanded && (
        <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-black/60 px-3 py-2 backdrop-blur">
          <span className="min-w-0 truncate text-[12px] text-white">{label}</span>
          <button type="button" className="ml-auto flex size-9 items-center justify-center rounded-lg bg-black/60 text-white" title={t("desktopViewer.exitFullscreen")} aria-label={t("desktopViewer.exitFullscreen")} onClick={() => void toggleFullscreen()}>
            <Minimize size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5">
        <button type="button" className={icon} disabled={!connected} title={t("desktopViewer.keyboard")} aria-label={t("desktopViewer.keyboard")} aria-pressed={panel === "keyboard"} onClick={() => setPanel(panel === "keyboard" ? null : "keyboard")}>
          <Keyboard size={16} aria-hidden="true" />
        </button>
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

      {panel !== null && (
        <form
          className={cn("absolute inset-x-2 z-10 rounded-xl border border-hairline bg-panel/95 p-3 shadow-2xl backdrop-blur", expanded ? "bottom-16" : "bottom-14")}
          onSubmit={(event) => {
            event.preventDefault();
            if (!connected || panel !== "keyboard" || !rfb.current || !text) return;
            typeOnDesktop(rfb.current, text);
            setText("");
          }}
        >
          <label className="mb-2 block text-[11px] text-ink-secondary" htmlFor="local-desktop-text">
            {t(panel === "keyboard" ? "desktopViewer.text" : "desktopViewer.clipboardHint")}
          </label>
          <textarea
            id="local-desktop-text"
            rows={3}
            value={panel === "keyboard" ? text : clipboard}
            disabled={!connected}
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => (panel === "keyboard" ? setText(event.target.value) : setClipboard(event.target.value))}
            className="w-full resize-none rounded-lg border border-hairline bg-inset p-2 text-[13px] text-ink outline-none focus:border-focus"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {panel === "keyboard" ? (
              <>
                <button type="submit" disabled={!connected || !text} className="flex min-h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12px] font-medium text-accent-ink disabled:opacity-40">
                  <Send size={14} aria-hidden="true" />{t("desktopViewer.send")}
                </button>
                <button type="button" disabled={!connected} className="min-h-9 rounded-lg bg-control px-3 text-[12px] text-ink disabled:opacity-40" onClick={() => rfb.current?.sendKey(0xff09, "Tab")}>{t("desktopViewer.keyTab")}</button>
                <button type="button" disabled={!connected} className="min-h-9 rounded-lg bg-control px-3 text-[12px] text-ink disabled:opacity-40" onClick={() => rfb.current?.sendKey(0xff1b, "Escape")}>{t("desktopViewer.keyEscape")}</button>
                <button type="button" disabled={!connected} className="min-h-9 rounded-lg bg-control px-3 text-[12px] text-ink disabled:opacity-40" onClick={() => rfb.current?.sendCtrlAltDel()}>{t("desktopViewer.keyCtrlAltDel")}</button>
              </>
            ) : (
              <button type="button" disabled={!connected || !clipboard} className="min-h-9 rounded-lg bg-accent px-3 text-[12px] font-medium text-accent-ink disabled:opacity-40" onClick={() => { rfb.current?.clipboardPasteFrom(clipboard); setPanel(null); }}>
                <Clipboard size={14} aria-hidden="true" className="mr-1.5 inline" />{t("desktopViewer.send")}
              </button>
            )}
            <button type="button" className="ml-auto min-h-9 rounded-lg px-3 text-[12px] text-ink-secondary" onClick={() => setPanel(null)}>{t("desktopViewer.closePanel")}</button>
          </div>
        </form>
      )}
    </div>
  );
}
