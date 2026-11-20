import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Keyboard } from "lucide-react";
import type RFB from "@novnc/novnc";

import { cn } from "@/lib/cn";
import { deliverDeletion, sendSoftKey, typeOnDesktop } from "@/lib/desktop-connection";
import { t } from "@/lib/i18n";

/** Android raises its soft keyboard only for a focused text field, so the person's keystrokes land in
 *  an offscreen field and are forwarded to the remote desktop from there. Kept per viewer: the
 *  virtual keyboard is one shared surface, and two of them would steal focus from each other. */
export function useSoftKeyboard(client: () => RFB | null) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);

  const raise = () => {
    const node = field.current;
    if (!node) return;
    node.value = "";
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

  /** Everything the keyboard commits arrives here: characters, and the deletions it reports as an
   *  edit rather than as a key. A phone reports a whole word through beforeinput even when it emits
   *  no keydown per letter, which is what dictation, autocorrect and every IME do. */
  const onBeforeInput = (event: React.FormEvent<HTMLTextAreaElement>) => {
    const rfb = client();
    if (!rfb) return;
    const native = event.nativeEvent as InputEvent;
    // The field is emptied after every keystroke, so it never holds text of its own: a deletion
    // here has nothing local to remove and belongs to the desktop, which is what the person sees.
    if (deliverDeletion(rfb, native.inputType)) {
      event.preventDefault();
      field.current!.value = "";
      return;
    }
    if (!native.data) return;
    event.preventDefault();
    typeOnDesktop(rfb, native.data);
    field.current!.value = "";
  };

  /** Keys that are not characters — Enter, Backspace, the arrows — come here. A printable key also
   *  lands here when the runtime skips `beforeinput`; the two paths cannot both act on one keystroke,
   *  because sending a key here cancels the edit that would have followed it. */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const rfb = client();
    if (!rfb) return;
    if (event.nativeEvent.isComposing) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (sendSoftKey(rfb, event)) {
      // Without this the browser also emits the edit for the same key, and Backspace would delete
      // twice on the desktop.
      event.preventDefault();
      field.current!.value = "";
      return;
    }
    if ([...event.key].length !== 1) return;
    event.preventDefault();
    typeOnDesktop(rfb, event.key);
    field.current!.value = "";
  };

  return { field, open, raise, lower, onBeforeInput, onKeyDown };
}

export type SoftKeyboard = ReturnType<typeof useSoftKeyboard>;

/** The field every soft key goes through. It stays in the layout and inside the viewport at one
 *  pixel: Android raises the keyboard only for an editable field it can focus, and `display:none`,
 *  a detached node, or one layered behind the desktop never takes that focus. It ignores pointer
 *  events, so the desktop under it stays drivable, and it is transparent so it is never seen. */
export function SoftKeyboardField({ keyboard }: { keyboard: SoftKeyboard }) {
  return (
    <textarea
      ref={keyboard.field}
      aria-hidden="true"
      tabIndex={-1}
      autoCapitalize="sentences"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      onBeforeInput={keyboard.onBeforeInput}
      onKeyDown={keyboard.onKeyDown}
      onBlur={keyboard.lower}
      className="pointer-events-none absolute left-0 top-0 h-px w-px resize-none border-0 bg-transparent p-0 text-transparent caret-transparent opacity-0 outline-none"
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
