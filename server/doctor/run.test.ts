import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DOCTOR_BACKUPS_DIR, DoctorBackup } from "./backup.ts";
import { foldersCheck } from "./checks/folders.ts";
import { registryCheck } from "./checks/registry.ts";
import { settingsFileCheck } from "./checks/settings-file.ts";
import { tempFilesCheck } from "./checks/temp-files.ts";
import { runDoctor, reportLines } from "./run.ts";
import { doctorAtStart, doctorSummary, summaryOf } from "./start.ts";
import type { DoctorCheck } from "./types.ts";

const NOW = Date.parse("2026-11-19T12:00:00.000Z");
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), "omb-doctor-"));
  dirs.push(dir);
  for (const name of ["events", "native"]) mkdirSync(join(dir, name));
  return dir;
};
const deadPid = 999_999;

/** A check whose fix runs without error and changes nothing, as a chmod on a filesystem without modes does. */
function stubborn(): DoctorCheck & { looks: number } {
  const check = {
    looks: 0,
    id: "stubborn", title: "Stubborn", looksAt: "nothing",
    check: () => { check.looks += 1; return { status: "problem" as const, fixable: true, summary: "Still wrong." }; },
    fix: () => "Tried.",
  };
  return check;
}

describe("runDoctor", () => {
  it("does not count a fix that changed nothing as a repair", () => {
    const check = stubborn();
    const report = runDoctor({ dataDir: folder(), version: "9.9.9", mode: "start", fix: true, now: () => NOW, checks: [check] });
    expect(report.checks[0]).toMatchObject({ status: "problem", fixed: "Tried.", repaired: false });
    expect(report.counts.fixed).toBe(0);
    // The first look, the look right before the fix, and the look after it.
    expect(check.looks).toBe(3);
  });

  it("does not count a fix whose look after it failed as a repair", () => {
    let looks = 0;
    const check: DoctorCheck = {
      id: "breaks", title: "Breaks", looksAt: "nothing",
      check: () => {
        looks += 1;
        if (looks === 3) throw new Error("cannot look");
        return { status: "problem", fixable: true, summary: "Wrong." };
      },
      fix: () => "Done.",
    };
    const report = runDoctor({ dataDir: folder(), version: "9.9.9", mode: "start", fix: true, now: () => NOW, checks: [check] });
    expect(report.checks[0]).toMatchObject({ status: "failed", repaired: false });
    expect(report.counts.fixed).toBe(0);
  });

  it("runs no fix while a blocking problem is found, and says why", () => {
    const fix = vi.fn(() => "never");
    const report = runDoctor({
      dataDir: folder(), version: "9.9.9", mode: "start", fix: true, now: () => NOW,
      checks: [
        { id: "format", title: "Format", looksAt: "marker", check: () => ({ status: "problem", blocking: true, summary: "Newer data." }) },
        { id: "repairable", title: "Repairable", looksAt: "x", check: () => ({ status: "problem", fixable: true, summary: "Wrong." }), fix },
      ],
    });
    expect(fix).not.toHaveBeenCalled();
    expect(report.fix).toMatchObject({ asked: true, ran: false });
    expect(report.fix.why).toContain("Newer data. Nothing was changed.");
  });

  it("hands the first look to the looks before and after a fix, so a slow read happens once", () => {
    const earlier: unknown[] = [];
    const check: DoctorCheck = {
      id: "seen", title: "Seen", looksAt: "nothing",
      check: (ctx) => {
        earlier.push(ctx.earlier?.detail);
        return earlier.length === 3 ? { status: "ok", summary: "Fine." } : { status: "problem", fixable: true, summary: "Wrong.", detail: earlier.length };
      },
      fix: () => "Done.",
    };
    runDoctor({ dataDir: folder(), version: "9.9.9", mode: "start", fix: true, now: () => NOW, checks: [check] });
    expect(earlier).toEqual([undefined, 1, 1]);
  });

  it("keeps a copy of what it is about to change, and leaves no folder when it changes nothing", () => {
    const dir = folder();
    const clean = runDoctor({ dataDir: dir, version: "9.9.9", mode: "start", fix: true, now: () => NOW, checks: [foldersCheck()] });
    expect(clean.backup).toBeNull();
    expect(existsSync(join(dir, DOCTOR_BACKUPS_DIR))).toBe(false);

    writeFileSync(join(dir, "bots.json"), "not a list");
    const report = runDoctor({ dataDir: dir, version: "9.9.9", mode: "start", fix: true, now: () => NOW, checks: [registryCheck()] });
    expect(report.backup).toBeTruthy();
    expect(readdirSync(report.backup!).length).toBeGreaterThan(0);
  });
});

describe("the checks", () => {
  it("makes a missing folder, and reports a file where a folder should be as a person's job", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-doctor-"));
    dirs.push(dir);
    const report = runDoctor({ dataDir: dir, version: "v", mode: "start", fix: true, now: () => NOW, checks: [foldersCheck()] });
    expect(report.checks[0]).toMatchObject({ id: "folders", status: "fixed" });
    expect(existsSync(join(dir, "events"))).toBe(true);

    const broken = folder();
    rmSync(join(broken, "native"), { recursive: true, force: true });
    writeFileSync(join(broken, "native"), "a file");
    const refused = runDoctor({ dataDir: broken, version: "v", mode: "start", fix: true, now: () => NOW, checks: [foldersCheck()] });
    expect(refused.checks[0]).toMatchObject({ status: "problem", fixable: false });
  });

  it("puts back a damaged bots.json from the whole copy an interrupted save left, after copying both", () => {
    const dir = folder();
    const temp = join(dir, `bots.json.${deadPid}.${UUID}.tmp`);
    writeFileSync(temp, JSON.stringify([{ id: "bot-1", name: "Pepper" }]));
    const written = NOW - 60_000;
    utimesSync(temp, written / 1000, written / 1000);
    writeFileSync(join(dir, "bots.json"), '[{"id":"bot-1","na');
    utimesSync(join(dir, "bots.json"), (written - 60_000) / 1000, (written - 60_000) / 1000);

    const report = runDoctor({ dataDir: dir, version: "v", mode: "start", fix: true, now: () => NOW, checks: [registryCheck(), tempFilesCheck()] });
    expect(report.checks[0]).toMatchObject({ id: "registry", status: "fixed", repaired: true });
    expect(JSON.parse(require("node:fs").readFileSync(join(dir, "bots.json"), "utf8"))).toEqual([{ id: "bot-1", name: "Pepper" }]);
    expect(existsSync(temp)).toBe(false);
    // The damaged file and the copy that replaced it are both in the backup.
    expect(readdirSync(report.backup!)).toEqual(expect.arrayContaining(["bots.json"]));
  });

  it("keeps the bytes of a damaged registry it cannot replace, and says so", () => {
    const dir = folder();
    writeFileSync(join(dir, "groups.json"), "garbage");
    const report = runDoctor({ dataDir: dir, version: "v", mode: "start", fix: true, now: () => NOW, checks: [registryCheck()] });
    expect(report.checks[0]).toMatchObject({ status: "problem" });
    expect(report.checks[0]!.summary).toContain("groups.json is damaged");
    expect(report.checks[0]!.instruction).toContain("put back groups.json");
    expect(existsSync(join(dir, "groups.json")), "never deleted").toBe(true);
    expect(readdirSync(report.backup!)).toContain("groups.json");
  });

  it("moves a temp file whose writer is gone, and leaves a live process's alone", () => {
    const dir = folder();
    const dead = join(dir, `bots.json.${deadPid}.${UUID}.tmp`);
    const live = join(dir, `bots.json.${process.pid}.${UUID}.tmp`);
    writeFileSync(dead, "[]");
    writeFileSync(live, "[]");
    // This process's own pid counts as alive, so its temp file is only a leftover when it predates the run.
    const report = runDoctor({ dataDir: dir, version: "v", mode: "start", fix: true, now: () => NOW, startedAt: Date.now() + 60_000, checks: [tempFilesCheck()] });
    expect(report.checks[0]).toMatchObject({ status: "fixed", repaired: true });
    expect(existsSync(dead)).toBe(false);
  });

  it("says a config.json it cannot understand leaves the server on defaults, and points at the dated copies", () => {
    const dir = folder();
    writeFileSync(join(dir, "config.json"), "{not json");
    writeFileSync(join(dir, "config.json.bak.20261118-090000"), "{}");
    const report = runDoctor({ dataDir: dir, version: "v", mode: "start", fix: true, now: () => NOW, checks: [settingsFileCheck()] });
    expect(report.checks[0]).toMatchObject({ status: "problem", id: "settings-file" });
    expect(report.checks[0]!.instruction).toContain("one of the 1 dated copy");
    expect(report.fix.ran).toBe(true);
    expect(report.counts.fixed).toBe(0);
  });
});

describe("the doctor as a server starts", () => {
  it("runs once per version, and keeps a summary with check names only", () => {
    const dir = folder();
    const log = vi.fn();
    const first = doctorAtStart(dir, "0.4131.70", { now: () => NOW, log });
    expect(first).toMatchObject({ version: "0.4131.70", thisStart: true, checked: 8 });
    expect(doctorSummary()).toEqual(first);
    expect(log.mock.calls.some(([line]) => String(line).includes("first start of 0.4131.70"))).toBe(true);

    const again = doctorAtStart(dir, "0.4131.70", { now: () => NOW, log });
    expect(again).toMatchObject({ thisStart: false });
    // A new version runs it again.
    expect(doctorAtStart(dir, "0.4131.71", { now: () => NOW, log })).toMatchObject({ thisStart: true });
  });

  it("never stops the server: a check that throws is logged and the start goes on", () => {
    const dir = folder();
    const log = vi.fn();
    const broken: DoctorCheck = { id: "boom", title: "Boom", looksAt: "x", check: () => { throw new Error("cannot look"); } };
    const summary = doctorAtStart(dir, "v", { now: () => NOW, log, checks: [broken] });
    expect(summary?.problems).toEqual(["boom"]);
    expect(log.mock.calls.some(([line]) => String(line).includes("The check itself failed: cannot look"))).toBe(true);
  });

  it("summarises a report as ids, for a health line", () => {
    const dir = folder();
    const report = runDoctor({ dataDir: dir, version: "v", mode: "start", fix: false, now: () => NOW, checks: [foldersCheck(), settingsFileCheck()] });
    expect(summaryOf(report)).toEqual({ at: report.at, version: "v", checked: 2, fixed: [], problems: [] });
    expect(reportLines(report)).toEqual([]);
  });
});

describe("the doctor's backup folder", () => {
  it("keeps the newest runs and prunes the rest, naming folders valid on Windows", () => {
    const dir = folder();
    const first = new DoctorBackup(dir, () => NOW);
    writeFileSync(join(dir, "bots.json"), "[]");
    const path = first.copy("registry", join(dir, "bots.json"));
    expect(path).toContain(DOCTOR_BACKUPS_DIR);
    // The run's folder name carries no colon, so it is valid on Windows too.
    expect(first.path!.split(/[\\/]/).at(-1)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(-2)?$/);
    expect(statSync(first.path!).isDirectory()).toBe(true);
  });
});
