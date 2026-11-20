// The guest command a tool builds, read from the file the phone actually runs. A tool that forgets
// the shared /tmp works until it touches a scratch file, then reports the turn as failed with an
// EACCES it did not cause.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "..", "android-test", "linux", "android-local-computer.mjs"), "utf8");

/** The body of one `if (name === "...")` branch, up to the next one. */
function branch(name: string): string {
  const start = source.indexOf(`if (name === "${name}")`);
  expect(start, `${name} exists`).toBeGreaterThan(0);
  const next = source.indexOf("if (name ===", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

describe("this computer's guest commands", () => {
  it("gives every file and shell tool the app's own tmp", () => {
    // The rootfs's /tmp is mode 0700 and owned by a uid the guest never holds, so a command that
    // falls back to it fails with EACCES: `ls /tmp` alone reported the whole turn as failed.
    for (const tool of ["bash", "read_file", "write_file", "list_files"]) {
      const body = branch(tool);
      expect(body, `${tool} binds the shared tmp`).toContain("guest(bashArgs)");
      expect(body, `${tool} never runs without it`).not.toMatch(/runGuest\(guestCommand\(/);
    }
  });

  it("binds that tmp as /tmp, which is where a guest program looks", () => {
    expect(source).toContain('args.push("-b", `${LINUX}/tmp:/tmp`)');
  });

  it("looks for the display the launcher actually starts", () => {
    // The launcher runs Xvfb on :1, so the socket is X1; probing X3 answered "not running" for a
    // desktop that was up.
    expect(source).toContain('.X11-unix", "X1"');
    expect(source).not.toContain('.X11-unix", "X3"');
  });
});
