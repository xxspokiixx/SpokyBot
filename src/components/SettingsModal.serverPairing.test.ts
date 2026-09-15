import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettingsSection } from "@/state/store";
import { SettingsModal } from "./SettingsModal";

// #950: a packaged desktop build never surfaced a way to mint a session
// pairing code, so MCP clients (and a second desktop app) had no path to
// one. ServerPairingCard was gated on `!window.ogb`, hiding it from every
// desktop instance instead of only the ones that don't own the server
// being paired against. These tests pin the corrected `!remoteActive` gate.
const fixture = vi.hoisted(() => ({ section: "companion" as AppSettingsSection }));

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(),
  useStore: () => ({ state: { appSettingsSection: fixture.section }, dispatch: vi.fn() }),
}));
vi.mock("./RemoteComputerSection", () => ({ RemoteComputerSection: () => null }));
vi.mock("./CustomDomainSettings", () => ({ CustomDomainSettings: () => null }));
vi.mock("./CompanionSection", () => ({ CompanionSection: () => null }));
vi.mock("./ServerPairingCard", () => ({ ServerPairingCard: () => "SERVER_PAIRING_CARD_MARKER" }));

beforeEach(() => {
  vi.clearAllMocks();
  fixture.section = "companion";
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const render = () => renderToStaticMarkup(createElement(SettingsModal));

describe("Settings → Remote access: server pairing card visibility", () => {
  it("is offered on a hosted server reached from a browser (no window.ogb)", () => {
    vi.stubGlobal("window", {});
    expect(render()).toContain("SERVER_PAIRING_CARD_MARKER");
  });

  it("is offered inside the desktop app when it owns the server being paired against", () => {
    vi.stubGlobal("window", { ogb: {} });
    expect(render()).toContain("SERVER_PAIRING_CARD_MARKER");
  });

  it("is hidden when this desktop is itself a remote client of someone else's server", () => {
    vi.stubGlobal("window", { ogb: { remoteClient: { active: true } } });
    expect(render()).not.toContain("SERVER_PAIRING_CARD_MARKER");
  });
});
