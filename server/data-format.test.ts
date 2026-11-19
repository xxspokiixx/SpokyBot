import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { checkDataFormat, DATA_FORMAT, dataFormatStepProblem, DataFormatError, readDataFormat, stampDataFormat } from "./data-format.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const folder = () => { const dir = mkdtempSync(join(tmpdir(), "omb-data-format-")); dirs.push(dir); return dir; };
const write = (dir: string, marker: unknown) => writeFileSync(join(dir, "data-format.json"), typeof marker === "string" ? marker : JSON.stringify(marker));

describe("the data folder's format marker", () => {
  it("takes a folder with no marker as format 1", () => {
    expect(readDataFormat(folder())).toBeNull();
  });

  it("refuses to start on data a newer version wrote, saying which version and changing nothing", () => {
    const dir = folder();
    write(dir, { format: 2, writtenBy: "0.5000.1", writtenAt: "2026-11-19T00:00:00.000Z" });
    const before = readFileSync(join(dir, "data-format.json"), "utf8");
    expect(() => checkDataFormat(dir, "0.4131.70")).toThrow(DataFormatError);
    expect(() => checkDataFormat(dir, "0.4131.70")).toThrow(/written by a newer SpokyBot \(0.5000\.1\), in a format this version \(0\.4131\.70\) cannot read\. Nothing was changed/);
    expect(readFileSync(join(dir, "data-format.json"), "utf8")).toBe(before);
  });

  it("reads a format it covers, one ahead included", () => {
    const dir = folder();
    write(dir, { format: 2, writtenBy: "x", writtenAt: "" });
    expect(() => checkDataFormat(dir, "v", 2, 1)).not.toThrow();
  });

  it("records the version once, and never lowers what a newer one left", () => {
    const dir = folder();
    stampDataFormat(dir, "0.4131.70", DATA_FORMAT);
    expect(JSON.parse(readFileSync(join(dir, "data-format.json"), "utf8"))).toMatchObject({ format: 1, writtenBy: "0.4131.70" });
    write(dir, { format: 2, writtenBy: "newer", writtenAt: "" });
    stampDataFormat(dir, "0.4131.70", { writes: 1, reads: 2 });
    expect(JSON.parse(readFileSync(join(dir, "data-format.json"), "utf8"))).toMatchObject({ format: 2, writtenBy: "newer" });
  });

  it("keeps starting when the marker cannot be written, since the data itself is fine", () => {
    const dir = folder();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      stampDataFormat(dir, "v", DATA_FORMAT, () => { throw new Error("read-only folder"); });
      expect(warn.mock.calls[0]?.[0]).toContain("could not write");
      expect(existsSync(join(dir, "data-format.json"))).toBe(false);
    } finally { warn.mockRestore(); }
  });

  it("takes an unreadable marker as format 1 while no version writes anything newer", () => {
    const dir = folder();
    write(dir, "\u0000\u0000\u0000");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(readDataFormat(dir, 1)).toBeNull();
      expect(warn.mock.calls[0]?.[0]).toContain("taking the data as format 1");
    } finally { warn.mockRestore(); }
  });

  it("refuses a marker it cannot read once a newer format exists", () => {
    const dir = folder();
    write(dir, "");
    expect(() => readDataFormat(dir, 2)).toThrow(/cannot be read, so this version cannot tell whether it understands the data/);
  });
});

describe("an update's format step", () => {
  const released = { version: "0.4131.70", writes: 1, reads: 1 };

  it("allows the step that keeps a rollback readable", () => {
    expect(dataFormatStepProblem({ writes: 1, reads: 1 }, released)).toBeNull();
    expect(dataFormatStepProblem({ writes: 1, reads: 2 }, released)).toBeNull();
  });

  it("refuses writing a format the last release cannot read, a number going down, and a skipped format", () => {
    expect(dataFormatStepProblem({ writes: 2, reads: 2 }, released)).toContain("rolling back to it would leave data it cannot read");
    expect(dataFormatStepProblem({ writes: 1, reads: 1 }, { ...released, writes: 2, reads: 2 })).toContain("went down from release");
    expect(dataFormatStepProblem({ writes: 1, reads: 3 }, released)).toContain("one format at a time");
    expect(dataFormatStepProblem({ writes: 2, reads: 1 }, { ...released, writes: 2, reads: 2 })).toContain("reads (1) is below writes (2)");
  });
});
