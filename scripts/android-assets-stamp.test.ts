// The stamp is what makes the app replace its extracted bundle. It hashed only index.js, so a
// rebuild that changed just the bundle's package.json looked identical: the phone kept a server
// that reported a version the installed APK had never been built from.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "..", "android-test", "prepare-android-assets.mjs"), "utf8");

describe("the Android bundle stamp", () => {
  it("counts the bundle's package.json, which is the version the server reports", () => {
    const start = source.indexOf("const serverHash");
    expect(start, "serverHash is computed").toBeGreaterThan(0);
    const stamp = source.slice(start, source.indexOf("const uiHash", start));
    expect(stamp).toContain('"package.json"');
  });

  it("counts the bundle's code too, so a changed server is never mistaken for the old one", () => {
    const start = source.indexOf("const serverHash");
    const stamp = source.slice(start, source.indexOf("const uiHash", start));
    expect(stamp).toContain('"index.js"');
  });
});
