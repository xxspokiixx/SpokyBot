import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Keyboard } from "lucide-react";
import type RFB from "@novnc/novnc";

import { cn } from "@/lib/cn";
import { deliverDeletion, sendSoftKey, typeOnDesktop } from "@/lib/desktop-connection";
import { t } from "@/lib/i18n";

/** One invisible character the field always keeps, so Backspace has something to delete. A zero-width
 *  space renders as nothing, so the field looks empty and nothing visible can leak to the guest. */
const SENTINEL = "\u200B";

/** Android raises its soft keyboard only for a focused text field, so the person's keystrokes land in
 *  an offscreen field and are forwarded to the remote desktop from there. Kept per viewer: the
 *  virtual keyboard is one shared surface, and two of them would steal focus from each other. */
export function useSoftKeyboard(client: () => RFB | null) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);

  /** One invisible character the field always keeps, with the caret behind it.
   *
   *  A field with nothing in it answers Backspace with silence: the browser has nothing to remove,
   *  so it emits no edit at all, and a phone keyboard that reports Backspace as an edit rather than
   *  as a key never reaches the desktop. The field therefore always holds something the key can
   *  delete, and every edit here is intercepted, so the character itself never reaches the guest. */
  const resetField = (node: HTMLTextAreaElement) => {
    if (node.value !== SENTINEL) node.value = SENTINEL;
    try { node.setSelectionRange(SENTINEL.length, SENTINEL.length); } catch { /* unfocused */ }
  };

  const raise = () => {
    const node = field.current;
    if (!node) return;
    resetField(node);
    node.focus({ preventScroll: true });
    setOpen(true);
  };

  const lower = () => {
    field.current?.blur();
    setOpen(false);
  };

  /** noVNC focuses its own canvas on every click, and a canvas takes focus away from the field, so
   *  the soft keyboard's next character lands nowhere. While it is up, a focus that lands on the
   *  desktop comes straight back here; a real text field elsewhere in the app keeps its focus. */
  useEffect(() => {
    if (!open) return;
    const hold = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const onDesktop = target.tagName === "CANVAS" || Boolean(target.closest("[role='application']"));
      if (onDesktop) field.current?.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", hold);
    return () => document.removeEventListener("focusin", hold);
  }, [open]);

  /** The last edit acted on, so a keystroke that arrives through more than one listener is sent once.
   *
   *  A WebView reports one Backspace through up to three paths — keydown, beforeinput and input —
   *  and `preventDefault` on keydown does not always stop the other two, which made one tap delete
   *  four characters. The guard is by content and time, not by path, so it holds whichever
   *  combination a keyboard uses. */
  const acted = useRef<{ what: string; at: number } | null>(null);
  const claim = (what: string) => {
    const now = Date.now();
    if (acted.current && acted.current.what === what && now - acted.current.at < 120) return false;
    acted.current = { what, at: now };
    return true;
  };

  /** Edits come from the browser, which is the one path every keyboard shares. Attached natively:
   *  React's onBeforeInput is a polyfill over a non-standard textInput event that a WebView does not
   *  always emit, and a phone's Backspace arrives only as an edit. */
  useEffect(() => {
    const node = field.current;
    if (!node) return;
    const send = (inputType: string, data: string | null) => {
      const rfb = client();
      if (!rfb) return;
      if (!claim(`${inputType}:${data ?? ""}`)) return;
      // The field holds only the sentinel, so the browser's own edit is never wanted: the desktop
      // is what the person sees, and the sentinel must survive for the next Backspace.
      if (deliverDeletion(rfb, inputType) || data) {
        if (data) typeOnDesktop(rfb, data);
      }
      resetField(node);
    };
    const onEdit = (event: Event) => {
      const { inputType, data } = event as InputEvent;
      event.preventDefault();
      send(inputType, data ?? null);
    };
    // A runtime that drops beforeinput still fires input, where the value is the record of the edit:
    // text means something was typed, and a lost sentinel means something was deleted.
    const onInput = () => {
      const typed = node.value.split(SENTINEL).join("");
      send(typed ? "insertText" : "deleteContentBackward", typed || null);
      resetField(node);
    };
    node.addEventListener("beforeinput", onEdit);
    node.addEventListener("input", onInput);
    return () => {
      node.removeEventListener("beforeinput", onEdit);
      node.removeEventListener("input", onInput);
    };
  }, [client]);

  /** Keys that are not characters and produce no edit — the arrows, Tab, Escape, Home and End — are
   *  the only ones sent here. Backspace and Delete are left to the browser so they become a single
   *  edit, and every printable character likewise. */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const rfb = client();
    const node = field.current;
    if (!rfb || !node) return;
    if (event.nativeEvent.isComposing) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Backspace" || event.key === "Delete") return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (claim("enter")) typeOnDesktop(rfb, "\n");
      resetField(node);
      return;
    }
    if (sendSoftKey(rfb, event)) {
      event.preventDefault();
      resetField(node);
    }
  };

  return { field, open, raise, lower, onKeyDown };
}

export type SoftKeyboard = ReturnType<typeof useSoftKeyboard>;

/** The field every soft key goes through. It covers the desktop and is transparent, but it must be a
 *  real editable field: Gboard gives a hidden, aria-hidden, one-pixel input a degraded connection
 *  where letters arrive as keys and a Backspace produces no event at all. It is fully transparent
 *  and ignores pointer events, so the desktop under it is what the person sees and touches. */
export function SoftKeyboardField({ keyboard }: { keyboard: SoftKeyboard }) {
  return (
    <textarea
      ref={keyboard.field}
      tabIndex={-1}
      inputMode="text"
      enterKeyHint="send"
      autoCapitalize="sentences"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      onKeyDown={keyboard.onKeyDown}
      onBlur={keyboard.lower}
      className="pointer-events-none absolute inset-0 size-full resize-none overflow-hidden border-0 bg-transparent p-0 text-base text-transparent caret-transparent opacity-0 outline-none"
    />
  );
}

/** Raises and lowers the tablet's keyboard for the desktop under it. */
export function SoftKeyboardButton({ keyboard, className }: { keyboard: SoftKeyboard; className?: string }) {
  const title = t("desktopViewer.keyboard");
  return (
    <button
      type="button"
      className={cn(className, keyboard.open && "ring-2 ring-accent")}
      title={title}
      aria-label={title}
      aria-pressed={keyboard.open}
      // Pressing a button moves focus to the button, which would take it back from the field the
      // keyboard types into and lower the keyboard again. The press is what raises it, so the
      // browser's focus move is cancelled here.
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => (keyboard.open ? keyboard.lower() : keyboard.raise())}
    >
      <Keyboard size={16} aria-hidden="true" />
    </button>
  );
}

/** A tap on the desktop opens the keyboard, the way a phone opens one when a field is touched: the
 *  person cannot see which window took focus, so the keyboard follows the touch. A drag is a mouse
 *  gesture and leaves it alone. */
export function useTapRaisesKeyboard(canType: () => boolean, raise: () => void) {
  const opened = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { opened.current = null; }, []);
  return {
    onPointerDown: (event: React.PointerEvent) => {
      opened.current = event.pointerType === "touch" || event.pointerType === "pen"
        ? { x: event.clientX, y: event.clientY }
        : null;
    },
    onPointerUp: (event: React.PointerEvent) => {
      const from = opened.current;
      opened.current = null;
      if (!from || !canType()) return;
      // Scrolled or dragged: the person moved the desktop, not the cursor into a field.
      if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > 12) return;
      raise();
    },
  };
}
