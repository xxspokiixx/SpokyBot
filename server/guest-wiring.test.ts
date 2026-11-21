// Does the wrapper see the phone's environment through the entry points that matter?
// A unit check of the wiring, so the next device run is not a guess.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const procs = readFileSync(join(import.meta.dirname, "procs.ts"), "utf8");

describe("the guest wrapper is wired to the engine launch", () => {
  it("passes the real environment into resolution, from both entry points", () => {
    // Resolving without env is what made the wrapper invisible: OMB_ANDROID_STANDALONE lives in
    // the environment, so a call that omits it always answered "not the phone".
    expect(procs).toContain("resolveCli(cli, args, opts.env)");
    expect(procs).not.toMatch(/const resolved = resolveCli\(cli, args\);/);
  });
});
