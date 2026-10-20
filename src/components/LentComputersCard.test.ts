// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PageLending } from "../../electron/cloud-lending-ipc.mjs";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => ({ ...await importOriginal<typeof import("@/state/store")>(), api: fixture.api }));
const { LentComputersCard, pageLendingLine } = await import("./LentComputers");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const off: PageLending = { available: true, on: false, status: null, folders: [], screen: false };
const lent: PageLending = { available: true, on: true, status: "lent", folders: ["Desktop", "Documents", "Downloads"].map((name) => ({ name, write: false })), screen: false };

beforeEach(() => {
  setLocale("en");
  fixture.api.mockReset().mockResolvedValue({ known: [] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (window as { ogb?: unknown }).ogb;
});
async function render() {
  await act(async () => root.render(createElement(LentComputersCard)));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

it("on My Cloud's page in the app, lending this computer is one switch and one line, right here: no leaving My Cloud", async () => {
  const open = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockResolvedValue(lent);
  (window as { ogb?: unknown }).ogb = { cloudLending: { open, state: vi.fn().mockResolvedValue(off), set } };
  await render();
  expect(host.querySelector('[data-lend-this-computer="off"]')).not.toBeNull();
  expect(host.textContent).toContain("Off: bots on My Cloud can't use this computer.");
  expect(host.textContent).not.toContain("Change what's lent");
  await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(set).toHaveBeenCalledExactlyOnceWith(true);
  expect(open).not.toHaveBeenCalled();
  expect(host.textContent).toContain("My Cloud can use Desktop, Documents, and Downloads (read only) on this computer.");
});

it("in a browser there is no switch for a computer, only the computers lent", async () => {
  fixture.api.mockResolvedValue({ known: [] });
  await render();
  expect(host.querySelector("[data-lend-this-computer]")).toBeNull();
  expect(host.textContent).toContain("No computer is lent to My Cloud.");
});

it("says how lending is going in plain words", () => {
  expect(pageLendingLine(off)).toBe("Off: bots on My Cloud can't use this computer.");
  expect(pageLendingLine({ ...lent, status: "busy" })).toBe("My Cloud is using this computer now.");
  expect(pageLendingLine({ ...lent, status: "asleep" })).toBe("My Cloud is asleep. Lending resumes when it wakes.");
  expect(pageLendingLine({ ...lent, status: "starting" })).toBe("Starting…");
  expect(pageLendingLine({ ...lent, folders: [], screen: true })).toBe("My Cloud can use apps and screen on this computer.");
});
