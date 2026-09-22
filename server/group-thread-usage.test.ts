import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GroupUsageReader } from "./group-thread-usage.ts";

let dir: string;
const row = (at: string, patch = {}) => ({ at, threadId: "room", botId: "one", botName: "One", input: 100, output: 10, cachedInput: 80, costUsd: 0.01, ...patch });
const write = (month: string, rows: unknown[]) => writeFileSync(join(dir, "usage", `${month}.jsonl`), rows.map(item => JSON.stringify(item)).join("\n") + "\n");
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "omb-group-usage-")); mkdirSync(join(dir, "usage")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("group thread accounting", () => {
  it("combines months and speakers while isolating unrelated threads", () => {
    write("2026-08", [row("2026-08-02"), row("2026-08-01"), row("2026-08-03", { threadId: "private" })]);
    write("2026-09", [row("2026-09-01", { botId: "two", botName: "Two", input: 200, cachedInput: 150 })]);
    const reader = new GroupUsageReader(dir);
    expect(reader.forThread("room")).toMatchObject({ input: 400, output: 30, cachedInput: 310, costUsd: 0.03, turns: 3, lastSpeaker: { botId: "two", name: "Two" }, lastTurn: { input: 200, output: 10, cachedInput: 150 } });
    expect(reader.forThread("empty")).toBeUndefined();
    expect(new GroupUsageReader(dir).forThread("room")).toEqual(reader.forThread("room"));
  });

  it("refreshes after appends and truncation and ignores damaged rows", () => {
    write("2026-09", [row("2026-09-01"), null, row("bad"), row("2026-09-02", { input: -1 })]);
    const reader = new GroupUsageReader(dir);
    const file = join(dir, "usage", "2026-09.jsonl");
    appendFileSync(file, "{unfinished\n");
    expect(reader.forThread("room")?.turns).toBe(1);
    appendFileSync(file, JSON.stringify(row("2026-09-03", { input: 10, cachedInput: 500 })) + "\n");
    expect(reader.forThread("room")).toMatchObject({ input: 110, cachedInput: 90, turns: 2 });
    write("2026-09", [row("2026-09-04")]);
    expect(reader.forThread("room")?.turns).toBe(1);
    rmSync(file);
    expect(reader.forThread("room")).toBeUndefined();
  });

  it("never treats omitted cache information as zero", () => {
    write("2026-09", [row("2026-09-01"), row("2026-09-02", { cachedInput: undefined, costUsd: null }), row("2026-09-03")]);
    const usage = new GroupUsageReader(dir).forThread("room")!;
    expect(usage.cachedInput).toBeUndefined();
    expect(usage.lastTurn?.cachedInput).toBe(80);
    expect(usage.costUsd).toBe(0.02);
    expect(usage.input).toBe(300);
  });

  it("returns independent snapshots and handles absent ledgers", () => {
    write("2026-09", [row("2026-09-01")]);
    const reader = new GroupUsageReader(dir);
    reader.forThread("room")!.lastSpeaker!.name = "Changed";
    expect(reader.forThread("room")!.lastSpeaker!.name).toBe("One");
    expect(new GroupUsageReader(join(dir, "absent")).forThread("room")).toBeUndefined();
  });
});
