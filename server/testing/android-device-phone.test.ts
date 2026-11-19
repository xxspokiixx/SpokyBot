// The on-device proxy is a plain .mjs file the app stages into the APK, so it is loaded here by path: what this checks is
// the contract the desktop proxy and this one share — the same tool names, the same batch rules, the same wording.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "..", "..", "android-test", "linux", "android-device-phone.mjs"), "utf8");

/** The file's own parseSteps, run with nothing else of the server around it. */
function loadParseSteps(): (raw: unknown) => Array<{ action: string }> {
  const start = source.indexOf("function parseSteps(raw) {");
  const end = source.indexOf("\n}\n", start) + 2;
  const body = source.slice(start, end);
  const context = vm.createContext({ MAX_STEPS: 12, MAX_WAIT_SECONDS: 10, STEP_TOOLS: ["open_app", "tap_text", "tap", "swipe", "type_text", "press", "read_screen"] });
  vm.runInContext(`${body}\nthis.parseSteps = parseSteps;`, context);
  return (context as unknown as { parseSteps: (raw: unknown) => Array<{ action: string }> }).parseSteps;
}

describe("the on-device proxy's batch", () => {
  const parseSteps = loadParseSteps();

  it("takes the same steps as the desktop proxy, from a list or from JSON text", () => {
    expect(parseSteps([{ action: "tap_text", text: "Search" }, { action: "wait", seconds: 2 }])).toHaveLength(2);
    expect(parseSteps('[{"action":"press","key":"back"}]')).toHaveLength(1);
  });

  it("refuses an empty list, an unknown action and a wild wait before doing anything", () => {
    expect(() => parseSteps([])).toThrow("non-empty list");
    expect(() => parseSteps([{ action: "launch_missiles" }])).toThrow("step 1 has no known action");
    expect(() => parseSteps([{ action: "wait", seconds: 60 }])).toThrow("seconds must be 0 to 10");
    expect(() => parseSteps(Array.from({ length: 13 }, () => ({ action: "read_screen" })))).toThrow("at most 12 steps");
    expect(() => parseSteps([{ action: "nope" }])).toThrow("No step was performed");
  });
});

describe("the two proxies announce the same tools", () => {
  it("names the batch and the keys that wake and sleep the phone", () => {
    expect(source).toContain('name: "batch"');
    expect(source).toContain("wakeup: \"KEYCODE_WAKEUP\"");
    expect(source).toContain("sleep: \"KEYCODE_SLEEP\"");
    // The hint points a model at batch from every step tool, except read_screen itself.
    expect(source).toContain("const takesBatchHint = (name) => name !== \"read_screen\" && STEP_TOOLS.includes(name);");
  });
});
