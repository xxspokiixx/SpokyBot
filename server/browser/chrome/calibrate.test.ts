import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import { removeTempDir } from "../../testing/cleanup.ts";
import { CdpBrowser } from "../cdp/browser.ts";
import { FakeChrome } from "../testing/fake-chrome.ts";
import { calibrateIdentity, identityFile, loadOrCalibrateIdentity, openCalibrationPage, type CalibratedIdentity } from "./calibrate.ts";

const folders: string[] = [];
afterAll(async () => { for (const folder of folders) await removeTempDir(folder); });

function folder(): string {
  const made = mkdtempSync(join(tmpdir(), "omb-calibrate-test-"));
  folders.push(made);
  return made;
}

const READ: CalibratedIdentity = {
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  userAgentMetadata: {
    brands: [{ brand: "Chromium", version: "153" }], fullVersionList: [{ brand: "Chromium", version: "153.0.8010.47" }], fullVersion: "153.0.8010.47",
    platform: "macOS", platformVersion: "26.3.1", architecture: "arm", model: "", mobile: false, bitness: "64", wow64: false, formFactors: ["Desktop"],
  },
  product: "Chrome/153.0.8010.47",
  fingerprint: "",
  calibratedAt: "2026-10-16T00:00:00.000Z",
};

/** A Chrome whose first navigations end in `errorText`, as Chrome for Testing on Windows cancels a fresh profile's first one. */
class FailingFirstNavigations extends FakeChrome {
  readonly #listeners = new Set<(message: string) => void>();
  #failures: number;
  readonly #errorText: string;

  constructor(failures: number, errorText = "net::ERR_ABORTED") {
    super();
    this.#failures = failures;
    this.#errorText = errorText;
  }

  override onMessage(listener: (message: string) => void): void {
    this.#listeners.add(listener);
    super.onMessage(listener);
  }

  override send(message: string): void {
    const { id, method, params = {}, sessionId } = JSON.parse(message) as { id: number; method: string; params?: Record<string, unknown>; sessionId?: string };
    if (method !== "Page.navigate" || this.#failures === 0) return super.send(message);
    this.#failures--;
    this.sent.push({ method, params, sessionId: sessionId ?? null });
    const answer = JSON.stringify({ id, result: { frameId: "T1", loaderId: "aborted", errorText: this.#errorText }, sessionId });
    queueMicrotask(() => { for (const listener of this.#listeners) listener(answer); });
  }
}

async function firstTab(chrome: FakeChrome) {
  const browser = await CdpBrowser.connect(chrome, { identity: null, headless: true, permissions: false });
  return browser.waitForPage();
}

describe("opening the calibration page", () => {
  const url = "http://127.0.0.1:9/";
  const navigations = (chrome: FakeChrome) => chrome.sent.filter((sent) => sent.method === "Page.navigate").length;

  it("opens it again when Chrome cancels the first navigation", async () => {
    const chrome = new FailingFirstNavigations(1);
    const tab = await firstTab(chrome);
    await openCalibrationPage(tab, url, 5_000);
    expect(tab.url()).toBe(url);
    expect(navigations(chrome)).toBe(2);
  });

  it("gives up when the second navigation is cancelled too, and never repeats another failure", async () => {
    const twice = new FailingFirstNavigations(2);
    await expect(openCalibrationPage(await firstTab(twice), url, 5_000)).rejects.toThrow(/failed: ERR_ABORTED/);
    expect(navigations(twice)).toBe(2);
    const refused = new FailingFirstNavigations(1, "net::ERR_CONNECTION_REFUSED");
    await expect(openCalibrationPage(await firstTab(refused), url, 5_000)).rejects.toThrow(/failed: ERR_CONNECTION_REFUSED/);
    expect(navigations(refused)).toBe(1);
  });
});

describe("reading a Chrome's own identity", () => {
  it.skipIf(process.platform === "win32")("starts the binary headless over a pipe, off the keychain, on the account's real home, and says when it exits", async () => {
    const dir = folder();
    const chrome = join(dir, "chrome");
    writeFileSync(chrome, `#!/bin/sh\n{ printf '%s\\n' "$HOME" "$@"; echo ::end::; } >> '${dir}/runs'\nexit 3\n`, { mode: 0o755 });
    await expect(calibrateIdentity({ executablePath: chrome, host: "desktop", env: { PATH: "/usr/bin:/bin", HOME: "/tmp/not-a-home" }, tmpRoot: dir, handshakeTimeoutMs: 10_000 })).rejects.toThrow(/exited|closed its DevTools pipe/);
    const runs = readFileSync(join(dir, "runs"), "utf8").split("::end::\n").filter(Boolean).map((run) => run.split("\n").filter(Boolean));
    expect(runs.map(([home]) => home)).toEqual(runs.map(() => userInfo().homedir));
    const [launch, ...diagnosis] = runs;
    const args = launch!.slice(1);
    expect(args).toContain("--headless=new");
    expect(args).toContain(process.platform === "darwin" ? "--use-mock-keychain" : "--password-store=basic");
    expect(args).toContain("--remote-debugging-pipe");
    expect(args.filter((arg) => arg.startsWith("--remote-debugging-port"))).toEqual([]);
    expect(diagnosis.map((run) => run.slice(1))).toEqual(process.platform === "linux" ? [["--version"]] : []);
  });

  it("reads it once per binary, and again after the binary changed in place", async () => {
    const dir = folder();
    const app = join(dir, "Google Chrome.app", "Contents");
    mkdirSync(join(app, "MacOS"), { recursive: true });
    const chrome = join(app, "MacOS", "Google Chrome");
    writeFileSync(chrome, "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(join(app, "Info.plist"), "<plist>153</plist>");
    const calibrate = vi.fn(async () => ({ ...READ }));
    const options = { executablePath: chrome, host: "desktop" as const };
    expect((await loadOrCalibrateIdentity(dir, options, calibrate)).calibrated).toBe(true);
    expect((await loadOrCalibrateIdentity(dir, options, calibrate)).calibrated).toBe(false);
    expect(calibrate).toHaveBeenCalledOnce();
    const stored = JSON.parse(readFileSync(identityFile(dir, chrome), "utf8")) as CalibratedIdentity;
    expect(stored.product).toBe("Chrome/153.0.8010.47");
    writeFileSync(join(app, "Info.plist"), "<plist>154 with a longer version</plist>");
    expect((await loadOrCalibrateIdentity(dir, options, calibrate)).calibrated).toBe(true);
    expect(calibrate).toHaveBeenCalledTimes(2);
  });
});
