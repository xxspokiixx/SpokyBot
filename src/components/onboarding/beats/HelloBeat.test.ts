// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { WelcomeFields } from "@/lib/welcome-draft";

const store = vi.hoisted(() => ({ api: vi.fn(), dispatch: vi.fn(), state: {} as Record<string, unknown> }));
vi.mock("@/state/store", () => ({ api: store.api, useStore: () => ({ state: store.state, dispatch: store.dispatch }) }));
const analytics = vi.hoisted(() => ({ identifyEmail: vi.fn(), track: vi.fn() }));
vi.mock("@/lib/analytics", () => analytics);
const { HelloBeat } = await import("./HelloBeat");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const props = { onNext: vi.fn(), onSkip: vi.fn(), setMascot: vi.fn(), bump: vi.fn(), onFields: vi.fn() };
let host: HTMLDivElement, root: Root;
const show = async (fields: WelcomeFields, hosted?: boolean) => {
  await act(async () => { root.render(createElement(HelloBeat, { ...props, fields, ...(hosted === undefined ? {} : { hosted }) })); });
};
const button = (label: string) => [...host.querySelectorAll("button")].find((node) => node.textContent === label)!;
const press = async (label: string) => { await act(async () => { button(label).click(); }); };
const flush = async () => { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); }); };
const putBodies = () => store.api.mock.calls.filter(([, init]) => init?.method === "PUT").map(([, init]) => JSON.parse(init.body));

beforeEach(() => {
  setLocale("en");
  store.api.mockReset();
  store.api.mockImplementation(async (_path: string, init: { body: string }) => ({ profile: JSON.parse(init.body).profile }));
  store.dispatch.mockReset();
  store.state = { config: { profile: { name: "", email: "" } } };
  for (const fn of [...Object.values(props), analytics.identifyEmail, analytics.track]) fn.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("the greeting beat", () => {
  it("asks a hosted workspace for nothing and saves nothing", async () => {
    await show({ name: "", email: "" }, true);
    expect(host.querySelector("input")).toBeNull();
    expect(host.textContent).not.toContain("let you know when big things ship");
    expect(host.textContent).toContain("shared OpenMausBot");
    expect(host.textContent).toContain("nothing to install");
    await press("Continue");
    expect(props.onNext).toHaveBeenCalledOnce();
    expect(store.api).not.toHaveBeenCalled();
  });

  it("keeps the desktop greeting with its name and email fields, and says where the email goes", async () => {
    await show({ name: "", email: "" });
    expect(host.querySelector('input[type="email"]')?.getAttribute("placeholder")).toBe("you@example.com");
    expect(host.textContent).toContain("let you know when big things ship");
    expect(host.textContent).toContain("We only use your email to tell you about OpenMausBot updates.");
    expect(host.textContent).not.toContain("shared OpenMausBot");
  });

  it("lets Continue go on with no email at all", async () => {
    await show({ name: "", email: "" });
    expect(button("Continue").disabled).toBe(false);
    await press("Continue");
    expect(props.onNext).toHaveBeenCalledOnce();
    expect(store.api, "nothing typed, nothing to save").not.toHaveBeenCalled();
  });

  it("says so under the field when the email is not valid, and holds Continue only while it is not", async () => {
    await show({ name: "Ada", email: "ada@" });
    expect(host.textContent).toContain("Check the email address.");
    expect(button("Continue").disabled).toBe(true);
    expect(host.querySelector('input[type="email"]')?.getAttribute("aria-invalid")).toBe("true");
    await show({ name: "Ada", email: "ada@example.com" });
    expect(host.textContent).not.toContain("Check the email address.");
    expect(button("Continue").disabled).toBe(false);
    await show({ name: "Ada", email: "" });
    expect(host.textContent).not.toContain("Check the email address.");
    expect(button("Continue").disabled).toBe(false);
  });

  it("Continue saves the name and the email, shows it is saving, and goes on once saved", async () => {
    let release!: (value: unknown) => void;
    store.api.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    await show({ name: " Ada ", email: "Ada@Example.com " });
    await press("Continue");
    expect(button("Saving…").disabled).toBe(true);
    expect(button("Maybe later").disabled, "no second way forward while saving").toBe(true);
    expect(props.onNext).not.toHaveBeenCalled();
    await act(async () => { release({ profile: { name: "Ada", email: "ada@example.com" } }); });
    await flush();
    expect(putBodies()).toEqual([{ profile: { name: "Ada", email: "ada@example.com" } }]);
    expect(props.onNext).toHaveBeenCalledOnce();
    expect(analytics.identifyEmail).toHaveBeenCalledWith("ada@example.com");
  });

  it("Maybe later still saves the name typed, and the email when it is valid, and goes on at once", async () => {
    await show({ name: "Ada", email: "ada@example.com" });
    await press("Maybe later");
    expect(props.onSkip).toHaveBeenCalledOnce();
    await flush();
    expect(putBodies()).toEqual([{ profile: { name: "Ada", email: "ada@example.com" } }]);
    expect(analytics.identifyEmail, "kept on this computer only: Maybe later never ties analytics to the email").not.toHaveBeenCalled();
    store.api.mockClear();
    await show({ name: "Grace", email: "grace@" });
    await press("Maybe later");
    await flush();
    expect(putBodies(), "an invalid email is left out").toEqual([{ profile: { name: "Grace" } }]);
  });

  it("never writes blanks over a saved profile", async () => {
    store.state = { config: { profile: { name: "Ada", email: "ada@example.com" } } };
    await show({ name: "", email: "" });
    await press("Maybe later");
    await press("Continue");
    await flush();
    expect(store.api).not.toHaveBeenCalled();
  });

  it("reports every keystroke to the flow, which keeps the fields", async () => {
    await show({ name: "", email: "" });
    const name = host.querySelector<HTMLInputElement>('input[type="text"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Ada");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(props.onFields).toHaveBeenLastCalledWith({ name: "Ada", email: "" });
  });
});

describe("Continue after Maybe later already kept the email", () => {
  it("still ties analytics to it, as Continue always has", async () => {
    store.state = { config: { profile: { name: "Ada", email: "ada@example.com" } } };
    await show({ name: "Ada", email: "ada@example.com" });
    await press("Continue");
    await flush();
    expect(store.api, "nothing new to save").not.toHaveBeenCalled();
    expect(props.onNext).toHaveBeenCalledOnce();
    expect(analytics.identifyEmail).toHaveBeenCalledWith("ada@example.com");
  });
});
