import { describe, expect, it } from "vitest";

import { namesOwnCause, NO_ROOM_TEXT, outOfProcesses, shortageCode } from "./process-shortage.ts";

const spawnError = (message: string, code?: string) => Object.assign(new Error(message), code ? { code } : {});

describe("a spawn the machine refused", () => {
  it("is recognised by Node's code and by its message at the head of a failure", () => {
    for (const code of ["EAGAIN", "EMFILE", "ENFILE", "ENOMEM"] as const) expect(shortageCode(spawnError("x", code))).toBe(code);
    expect(shortageCode(new Error("nope"))).toBeNull();
    expect(outOfProcesses("Error: spawn failed: spawn /usr/bin/claude EAGAIN")).toBe(true);
    expect(outOfProcesses("spawnSync node EMFILE")).toBe(true);
    expect(outOfProcesses(`${NO_ROOM_TEXT}`)).toBe(true);
  });

  it("is never read out of an engine's own stderr tail", () => {
    // A file watcher's "EMFILE: too many open files" comes from an engine that did run: its turn may still go elsewhere.
    expect(outOfProcesses("engine exited 1: Error: EMFILE: too many open files, watch")).toBe(false);
    expect(outOfProcesses("The model returned no text")).toBe(false);
  });

  it("is not relabelled when the failure names its own cause", () => {
    expect(namesOwnCause("401 authentication_error: invalid api key")).toBe(true);
    expect(namesOwnCause("usage limit reached; resets at 3pm")).toBe(true);
    expect(namesOwnCause("the tool server would not start")).toBe(true);
    expect(namesOwnCause("spawn EAGAIN")).toBe(false);
  });
});
