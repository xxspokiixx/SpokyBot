// @vitest-environment happy-dom
// Moving through the welcome: one step per press however fast the clicks come, one count for the dots and the counter,
// and a reload that resumes where the person was with what they typed.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { WELCOME_DRAFT_KEY } from "@/lib/welcome-draft";
import type { SetupDetection } from "../../../shared/setup-import";

const f = vi.hoisted(() => ({ state: {} as Record<string, unknown>, dispatch: vi.fn(), api: vi.fn() }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: f.state, dispatch: f.dispatch }), api: f.api }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), setEmailGateDone: vi.fn(), identifyEmail: vi.fn() }));
vi.mock("@/components/Avatar", () => ({ MausAvatar: () => null }));
vi.mock("@/components/DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false } } }) }));
vi.mock("@/components/EngineSetup", () => ({ EngineSetup: () => null }));
const { WelcomeFlow, STEP_HOLD_MS } = await import("./WelcomeFlow");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const text = () => host.textContent ?? "";
const show = async (extra: Record<string, unknown> = {}) => {
  await act(async () => { root.render(createElement(WelcomeFlow, { onDone: vi.fn(), dictation: true, cloudOffer: null, setupImport: null, ...extra })); });
};
const reload = async (extra: Record<string, unknown> = {}) => {
  await act(async () => root.unmount());
  root = createRoot(host);
  await show(extra);
};
const button = (label: string) => [...host.querySelectorAll("button")].find((node) => node.textContent === label);
const press = async (label: string) => { await act(async () => { button(label)!.click(); }); };
const settle = async (ms = STEP_HOLD_MS + 50) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); };
const type = async (selector: string, value: string) => {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const NAME = 'input[type="text"]', EMAIL = 'input[type="email"]';
const draft = () => JSON.parse(localStorage.getItem(WELCOME_DRAFT_KEY) ?? "null");
const putBodies = () => f.api.mock.calls.filter(([, init]) => init?.method === "PUT").map(([, init]) => JSON.parse(init.body));

beforeEach(() => {
  setLocale("en");
  localStorage.clear();
  f.dispatch.mockReset();
  f.api.mockReset();
  f.api.mockImplementation(async (path: string, init?: { body?: string }) => (path === "/api/instances" ? { instances: [] } : JSON.parse(init?.body ?? "{}")));
  f.state = { instances: [], config: { profile: { name: "", email: "" } }, cloudAdd: null, bots: [] };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("moving through the welcome", () => {
  it("moves exactly one step for a double click, and holds Back while the step changes", async () => {
    await show();
    expect(text()).toContain("Step 1 of 3");
    await press("Maybe later");
    expect(text()).toContain("Step 2 of 3");
    expect(button("Back")!.disabled).toBe(true);
    await press("Continue");
    expect(text(), "the second click landed on the new step's Continue").toContain("Step 2 of 3");
    expect(text()).toContain("Connect an AI");
    await settle();
    expect(button("Back")!.disabled).toBe(false);
    await press("Continue");
    expect(text()).toContain("Step 3 of 3");
  });

  it("never finishes the welcome from a click meant for the step before the last", async () => {
    const onDone = vi.fn();
    await show({ onDone, initialBeat: "engines" });
    await press("Continue");
    expect(text()).toContain("Step 3 of 3");
    await press("Continue");
    expect(onDone).not.toHaveBeenCalled();
    await settle();
    await press("Continue");
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("shows as many dots as steps, the current one on the step the counter names", async () => {
    await show();
    for (const step of [1, 2, 3]) {
      const dots = [...host.querySelectorAll("[data-step-dot]")];
      expect(dots).toHaveLength(3);
      expect(dots.findIndex((dot) => dot.getAttribute("data-current") === "true")).toBe(step - 1);
      expect(text()).toContain(`Step ${step} of 3`);
      if (step < 3) {
        await press(step === 1 ? "Maybe later" : "Continue");
        await settle();
      }
    }
  });
});

describe("a reload in the middle of the welcome", () => {
  it("resumes on the same step with what was typed", async () => {
    await show();
    await type(NAME, "Ada");
    await type(EMAIL, "ada@exa");
    expect(draft()).toEqual({ beat: "hello", name: "Ada", email: "ada@exa" });
    await reload();
    expect((host.querySelector(NAME) as HTMLInputElement).value).toBe("Ada");
    expect((host.querySelector(EMAIL) as HTMLInputElement).value).toBe("ada@exa");
    expect(text()).toContain("Check the email address.");
    await type(EMAIL, "");
    await press("Maybe later");
    expect(draft()).toMatchObject({ beat: "engines", name: "Ada" });
    await reload();
    expect(text()).toContain("Connect an AI");
    expect(text()).toContain("Step 2 of 3");
    await press("Back");
    expect((host.querySelector(NAME) as HTMLInputElement).value).toBe("Ada");
  });

  it("opens on a step that joins late (the import step) once it is offered, or the step before it until then", async () => {
    const found: SetupDetection = { skills: [{ name: "pdf", source: "claudeCode" }], tools: [] };
    let answer!: (value: SetupDetection) => void;
    const client = { detect: vi.fn(() => new Promise<SetupDetection>((resolve) => { answer = resolve; })), apply: vi.fn() };
    localStorage.setItem(WELCOME_DRAFT_KEY, JSON.stringify({ beat: "import", name: "", email: "" }));
    await show({ setupImport: { client } });
    expect(text()).toContain("Connect an AI");
    await act(async () => { answer(found); });
    await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(text()).toContain("Bring what you already use");
    expect(text()).toContain("Step 3 of 4");
  });

  it("is forgotten once the welcome is finished or skipped, which saves the name and a valid email", async () => {
    const onDone = vi.fn();
    await show({ onDone });
    await type(NAME, "Ada");
    await type(EMAIL, "ada@example.com");
    await press("Skip tour");
    expect(onDone).toHaveBeenCalledOnce();
    await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(putBodies()).toContainEqual({ profile: { name: "Ada", email: "ada@example.com" } });
    expect(localStorage.getItem(WELCOME_DRAFT_KEY)).toBeNull();
  });

  it("Escape keeps the name too, and leaves out an email still being typed", async () => {
    await show();
    await type(NAME, "Grace");
    await type(EMAIL, "grace@");
    await act(async () => { host.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(putBodies()).toContainEqual({ profile: { name: "Grace" } });
  });

  it("is neither read nor written by a replay from Settings or by the preview", async () => {
    localStorage.setItem(WELCOME_DRAFT_KEY, JSON.stringify({ beat: "engines", name: "Old", email: "" }));
    for (const extra of [{ replay: true }, { embedded: true }]) {
      await reload(extra);
      expect(text(), JSON.stringify(extra)).toContain("Step 1 of 3");
      expect((host.querySelector(NAME) as HTMLInputElement).value).toBe("");
      await type(NAME, "New");
      expect(draft()).toEqual({ beat: "engines", name: "Old", email: "" });
    }
  });
});
