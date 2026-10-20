// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PageLending } from "../../electron/cloud-lending-ipc.mjs";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => ({ ...await importOriginal<typeof import("@/state/store")>(), api: fixture.api }));
const { LentComputersCard, lentComputerLines, pageLendingLine } = await import("./LentComputers");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const off: PageLending = { available: true, on: false, status: null, folders: [], screen: false, internet: false };
const lent: PageLending = { available: true, on: true, status: "lent", folders: ["Desktop", "Documents", "Downloads"].map((name) => ({ name, write: false })), screen: false, internet: true };

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
  (window as { ogb?: unknown }).ogb = { platform: "darwin", cloudLending: { open, state: vi.fn().mockResolvedValue(off), set } };
  await render();
  expect(host.querySelector('[data-lend-this-computer="off"]')).not.toBeNull();
  expect(host.textContent).toContain("Let my bots use this Mac");
  expect(host.textContent).toContain("Off: bots on My Cloud can't use this computer.");
  expect(host.textContent).not.toContain("Change what's lent");
  await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(set).toHaveBeenCalledExactlyOnceWith(true);
  expect(open).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Your bots can use the internet connection and Desktop, Documents, and Downloads (read only) on this Mac.");
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
  expect(pageLendingLine({ ...lent, folders: [], screen: true, internet: false })).toBe("Your bots can use apps and screen on this computer.");
  expect(pageLendingLine({ ...lent, link: "unsupported" })).toBe("My Cloud is updating. Your bots can use this computer's internet connection once it's done.");
});

it("a refused folder says why plainly, with no Try again; only a failure trying again can fix says Try again", async () => {
  const set = vi.fn().mockRejectedValueOnce(new Error("Error invoking remote method 'cloud-lending:set': Error: lending-refused:home-or-root"))
    .mockRejectedValueOnce(new Error("Error invoking remote method 'cloud-lending:set': Error: My Cloud didn't answer"));
  (window as { ogb?: unknown }).ogb = { cloudLending: { open: vi.fn(), state: vi.fn().mockResolvedValue(off), set } };
  await render();
  const flip = async () => {
    await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  };
  await flip();
  const said = host.querySelector('[role="alert"]')!.textContent!;
  expect(said).toBe("Choose a folder inside your home folder, not the whole home folder or a whole disk.");
  expect(said).not.toContain("Try again");
  await flip();
  expect(host.querySelector('[role="alert"]')!.textContent).toBe("Could not change what is lent. Try again.");
});

it("on the phone or in a browser, a computer that lends its internet connection says so, and while it is away that the sites that turn away data centres open from My Cloud's own connection", () => {
  const computer = { id: "c", name: "Ash's MacBook", platform: "darwin" as const, online: true, busy: false, lent: true, lastSeenAt: Date.now(), lastUsedAt: null,
    scopes: { folders: 3, terminal: false, screen: false, internet: true } };
  expect(lentComputerLines(computer)).toEqual(["Online now", "Lends: internet connection, 3 folders", "Not used yet"]);
  const away = lentComputerLines({ ...computer, online: false, lastSeenAt: Date.now() - 5 * 60_000 });
  expect(away).toContain("While it's away, Instagram, YouTube and Google sign-in open from My Cloud's own connection and may turn your bots away.");
  expect(lentComputerLines({ ...computer, online: false, scopes: { ...computer.scopes, internet: false } }).join(" ")).not.toContain("My Cloud's own connection");
  expect(lentComputerLines({ ...computer, online: false, lent: false }).join(" ")).not.toContain("My Cloud's own connection");
});
