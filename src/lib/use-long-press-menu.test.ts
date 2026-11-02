// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LONG_PRESS_MS, createLongPressDetector } from "./use-long-press-menu";

type OneShot = {
  onOpen: ReturnType<typeof vi.fn>;
  detector: ReturnType<typeof createLongPressDetector>;
};

let row: HTMLElement;

// currentTarget is always the element the hook is spread on (the row); target is where the finger landed.
function press(currentTarget: Element, target: Element, pointer: { clientX: number; clientY: number; pointerType: string }) {
  return {
    clientX: pointer.clientX,
    clientY: pointer.clientY,
    pointerType: pointer.pointerType,
    target,
    currentTarget,
  };
}

function openOnHold(): OneShot {
  const onOpen = vi.fn();
  const detector = createLongPressDetector({ onOpen });
  return { onOpen, detector };
}

function clickEvent(type: string, target: EventTarget): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
  row = document.createElement("div");
  row.innerHTML = "<span>thread</span>";
  document.body.append(row);
});

afterEach(() => {
  row.remove();
  vi.useRealTimers();
});

describe("createLongPressDetector", () => {
  it("fires once after LONG_PRESS_MS at the press point with the pressed element", () => {
    const { onOpen, detector } = openOnHold();
    detector.down(press(row, row, { clientX: 40, clientY: 60, pointerType: "touch" }));
    detector.move({ clientX: 44, clientY: 64 });
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(onOpen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onOpen).toHaveBeenCalledWith({ x: 40, y: 60 }, row);
    expect(onOpen).toHaveBeenCalledTimes(1);
    detector.dispose();
  });

  it("never reacts to a mouse press", () => {
    const { onOpen, detector } = openOnHold();
    detector.down(press(row, row, { clientX: 0, clientY: 0, pointerType: "mouse" }));
    detector.up();
    vi.advanceTimersByTime(10_000);
    expect(onOpen).not.toHaveBeenCalled();
    expect(detector.claims("contextmenu")).toBe(false);
    expect(detector.claims("click")).toBe(false);
    detector.dispose();
  });

  it("cancels when the pointer moves further than 10px", () => {
    const { onOpen, detector } = openOnHold();
    detector.down(press(row, row, { clientX: 100, clientY: 100, pointerType: "touch" }));
    detector.move({ clientX: 105, clientY: 105 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onOpen, "a move within the 10px tolerance keeps the press").toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith({ x: 100, y: 100 }, row);
    detector.dispose();

    const second = openOnHold();
    second.detector.down(press(row, row, { clientX: 100, clientY: 100, pointerType: "touch" }));
    second.detector.move({ clientX: 110, clientY: 110 });
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(second.onOpen, "a move beyond the tolerance means scroll intent").not.toHaveBeenCalled();
    second.detector.dispose();
  });

  it("cancels on pointercancel, on pointerleave and on a quick release", () => {
    for (const end of ["cancel", "leave", "up"] as const) {
      const { onOpen, detector } = openOnHold();
      detector.down(press(row, row, { clientX: 1, clientY: 1, pointerType: "touch" }));
      if (end === "cancel") detector.cancel();
      if (end === "leave") detector.leave();
      if (end === "up") detector.up();
      vi.advanceTimersByTime(LONG_PRESS_MS * 2);
      expect(onOpen, end).not.toHaveBeenCalled();
      detector.dispose();
    }
  });

  it("ignores presses that land on links or form controls, but takes nested buttons and plain text", () => {
    const rowButton = document.createElement("button");
    rowButton.innerHTML = "<span>thread</span>";
    row.append(rowButton);

    const wrapper = document.createElement("div");
    wrapper.innerHTML = '<a href="#">link</a><input type="text" /><button><span>actions</span></button>';
    const link = wrapper.querySelector("a")!;
    const input = wrapper.querySelector("input")!;
    const nestedButton = wrapper.querySelector("button")!;
    const nestedSpan = nestedButton.querySelector("span")!;
    wrapper.append(link, input, nestedButton);
    row.append(wrapper);

    for (const target of [link, input]) {
      const { onOpen, detector } = openOnHold();
      detector.down(press(row, target, { clientX: 0, clientY: 0, pointerType: "touch" }));
      detector.up();
      vi.advanceTimersByTime(LONG_PRESS_MS * 2);
      expect(onOpen, `target ${target.outerHTML.slice(0, 32)} must not open the row menu`).not.toHaveBeenCalled();
      detector.dispose();
    }

    // Nested buttons and plain spans resolve to the row's own menu wherever the finger lands.
    for (const target of [nestedButton, nestedSpan, rowSpanBelowRow(), rowButton]) {
      const { onOpen, detector } = openOnHold();
      detector.down(press(row, target, { clientX: 0, clientY: 0, pointerType: "touch" }));
      vi.advanceTimersByTime(LONG_PRESS_MS);
      expect(onOpen, `target ${target.outerHTML.slice(0, 32)} opens the row menu`).toHaveBeenCalledTimes(1);
      detector.dispose();
    }
  });

  it("claims the contextmenu while holding and the click after release", () => {
    const { onOpen, detector } = openOnHold();
    detector.down(press(row, row, { clientX: 10, clientY: 10, pointerType: "touch" }));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(detector.claims("contextmenu")).toBe(true);
    expect(clickEvent("contextmenu", row).defaultPrevented).toBe(true);

    // A second finger may still tap while the first holds: its click passes.
    expect(detector.claims("click")).toBe(false);
    expect(clickEvent("click", row).defaultPrevented).toBe(false);

    detector.up();
    expect(detector.claims("click")).toBe(true);
    expect(clickEvent("click", row).defaultPrevented).toBe(true);
    expect(clickEvent("dblclick", row).defaultPrevented).toBe(true);
    expect(clickEvent("contextmenu", row).defaultPrevented).toBe(true);

    vi.advanceTimersByTime(700);
    expect(detector.claims("click")).toBe(false);
    expect(clickEvent("click", row).defaultPrevented).toBe(false);
    expect(onOpen).toHaveBeenCalledTimes(1);
    detector.dispose();
  });

  it("keeps the guards installed when a second gesture starts during the release window", () => {
    const { onOpen, detector } = openOnHold();
    detector.down(press(row, row, { clientX: 0, clientY: 0, pointerType: "touch" }));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    detector.up();
    // New press 500ms later, still inside the first gesture's release suppression.
    vi.advanceTimersByTime(500);
    detector.down(press(row, row, { clientX: 0, clientY: 0, pointerType: "touch" }));
    vi.advanceTimersByTime(500);
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(detector.claims("contextmenu")).toBe(true);
    expect(clickEvent("contextmenu", row).defaultPrevented).toBe(true);
    detector.dispose();
  });

  it("stopPropagation keeps row-level handlers of a swallowed release click silent", () => {
    const { detector } = openOnHold();
    const handled = vi.fn();
    row.addEventListener("click", handled);
    detector.down(press(row, row, { clientX: 0, clientY: 0, pointerType: "touch" }));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    detector.up();
    clickEvent("click", row);
    expect(handled).not.toHaveBeenCalled();
    row.removeEventListener("click", handled);
    detector.dispose();
  });

  it("dispose clears timers, the suppression state and the window guards", () => {
    const { onOpen, detector } = openOnHold();
    detector.down(press(row, row, { clientX: 0, clientY: 0, pointerType: "touch" }));
    detector.dispose();
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(onOpen).not.toHaveBeenCalled();
    expect(detector.claims("contextmenu")).toBe(false);
    expect(clickEvent("click", row).defaultPrevented).toBe(false);
  });
});

function rowSpanBelowRow(): Element {
  const bare = document.createElement("span");
  bare.textContent = "bare";
  row.append(bare);
  return bare;
}
