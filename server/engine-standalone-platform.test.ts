// An engine installed on the phone is an arm64 Linux build like any other; the key that finds it has
// to say so, or every standalone release looks like it has no download for this device.
import { describe, expect, it } from "vitest";

import { standalonePlatformKey } from "./engine-standalone.ts";

describe("the platform key an engine download is chosen by", () => {
  it("asks for the Linux build on Android, which runs it through the guest loader", () => {
    expect(standalonePlatformKey("android", "arm64", false)).toBe("linux-arm64");
  });

  it("leaves every other platform naming itself", () => {
    expect(standalonePlatformKey("darwin", "arm64", false)).toBe("darwin-arm64");
    expect(standalonePlatformKey("linux", "x64", false)).toBe("linux-x64");
    expect(standalonePlatformKey("linux", "arm64", true)).toBe("linux-arm64-musl");
    expect(standalonePlatformKey("win32", "x64", false)).toBe("win32-x64");
  });
});
