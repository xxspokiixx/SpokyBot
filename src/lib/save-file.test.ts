// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { androidSaveAvailable, tryAndroidSave } from "./save-file";

type BridgeStub = {
  capabilitiesJson(): string;
  buildVersion(): string;
  notify(): void;
  openExternal(): void;
  download: ReturnType<typeof vi.fn>;
  downloadBase64: ReturnType<typeof vi.fn>;
  saveBackup(): void;
};

function installBridge(): BridgeStub {
  const bridge: BridgeStub = {
    capabilitiesJson: () => "{}",
    buildVersion: () => "test",
    notify: vi.fn(),
    openExternal: vi.fn(),
    download: vi.fn(),
    downloadBase64: vi.fn(),
    saveBackup: vi.fn(),
  };
  Object.defineProperty(window, "ombAndroidCaps", { value: bridge, configurable: true });
  return bridge;
}

const decodeBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

afterEach(() => {
  Reflect.deleteProperty(window, "ombAndroidCaps");
  vi.unstubAllGlobals();
});

describe("androidSaveAvailable", () => {
  it("is false without the phone shell bridge", () => {
    expect(androidSaveAvailable()).toBe(false);
  });

  it("is true once the bridge is injected", () => {
    installBridge();
    expect(androidSaveAvailable()).toBe(true);
  });
});

describe("tryAndroidSave", () => {
  it("returns false without the bridge so the caller keeps its anchor flow", async () => {
    expect(await tryAndroidSave(new Blob(["hi"]), "hi.txt")).toBe(false);
  });

  it("hands loopback server URLs to the native download, with the mime the caller gave", async () => {
    const bridge = installBridge();
    const saved = await tryAndroidSave("http://127.0.0.1:8799/api/attachments/report.csv", "report.csv", "text/csv");
    expect(saved).toBe(true);
    expect(bridge.download).toHaveBeenCalledWith("http://127.0.0.1:8799/api/attachments/report.csv", "report.csv", "text/csv");
    expect(bridge.downloadBase64).not.toHaveBeenCalled();
  });

  it("writes blob bytes through the bridge, so the save dialog sees the file", async () => {
    const bridge = installBridge();
    const saved = await tryAndroidSave(new Blob(["Hi"], { type: "text/plain" }), "greeting.txt");
    expect(saved).toBe(true);
    expect(bridge.download).not.toHaveBeenCalled();
    const [filename, mimeType, base64] = bridge.downloadBase64.mock.calls[0] as unknown as [string, string, string];
    expect(filename).toBe("greeting.txt");
    expect(mimeType).toBe("text/plain");
    expect(new TextDecoder().decode(decodeBase64(base64))).toBe("Hi");
  });

  it("reads blob: URLs back into memory, which the shell cannot fetch", async () => {
    const bridge = installBridge();
    vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => new Blob(["many bytes here"]) })));
    const saved = await tryAndroidSave("blob:http://127.0.0.1:8799/abc", "stream.bin");
    expect(saved).toBe(true);
    expect(bridge.download).not.toHaveBeenCalled();
    const [filename, mimeType, base64] = bridge.downloadBase64.mock.calls[0] as unknown as [string, string, string];
    expect(filename).toBe("stream.bin");
    expect(mimeType).toBe("application/octet-stream");
    expect(new TextDecoder().decode(decodeBase64(base64))).toBe("many bytes here");
  });

  it("keeps chunked encoding intact past the single-conversion chunk", async () => {
    const bridge = installBridge();
    const bytes = new Uint8Array(0x8000 + 3).fill(65);
    const saved = await tryAndroidSave(new Blob([bytes]), "big.bin");
    expect(saved).toBe(true);
    const [, , base64] = bridge.downloadBase64.mock.calls[0] as unknown as [string, string, string];
    expect(decodeBase64(base64)).toEqual(bytes);
  });
});
