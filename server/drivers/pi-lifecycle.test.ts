import { chmodSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ensureDirs } from "../config.ts";
import type { ProviderInstance } from "../contracts.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { recordEvents, type EventRecorder } from "../testing/events.ts";
import { PiDriver } from "./pi.ts";

const CLI = fileURLToPath(new URL("../testing/fake-pi-lifecycle.mjs", import.meta.url));
let dir: string;
let instance: ProviderInstance;
let events: EventRecorder;
let ownedPid: number | undefined;

beforeEach(async () => {
  ensureDirs();
  chmodSync(CLI, 0o755);
  dir = mkdtempSync(join(tmpdir(), "omb-pi-lifecycle-"));
  instance = await PiDriver.create({
    instanceId: "pi-lifecycle",
    displayName: "Pi lifecycle fixture",
    enabled: true,
    config: { cli: CLI, fullAuto: false },
    environment: { FAKE_PI_LIFECYCLE_DUMP: join(dir, "rpc.jsonl") },
  });
  events = recordEvents(instance.adapter);
  ownedPid = undefined;
});

afterEach(async () => {
  await instance.dispose();
  if (ownedPid) {
    try { process.kill(ownedPid, "SIGKILL"); } catch {}
  }
  events.stop();
  await removeTempDir(dir);
});

it.each(["interrupt", "stopAll", "dispose"])("keeps ownership through %s until the CLI has stopped", async (action) => {
  await instance.adapter.sendTurn({ threadId: "cancel", text: "wait" });
  await events.until((event) => event.type === "item.started");
  const { pid } = JSON.parse(readFileSync(join(dir, "rpc.jsonl"), "utf8").trim()) as { pid: number };
  ownedPid = pid;
  let runningAtCompletion = false;
  instance.adapter.onEvent((event) => {
    if (event.type !== "turn.completed") return;
    try { process.kill(pid, 0); runningAtCompletion = true; } catch {}
  });
  const interrupted = action === "interrupt" ? instance.adapter.interruptTurn("cancel")
    : action === "stopAll" ? instance.adapter.stopAll() : instance.dispose();
  const ownedWhileStopping = instance.adapter.hasSession("cancel");
  const disposed = instance.dispose();
  await Promise.all([interrupted, disposed]);
  expect(ownedWhileStopping).toBe(true);
  expect(() => process.kill(pid, 0)).toThrow();
  expect(runningAtCompletion).toBe(false);
  expect(events.events.filter((event) => event.type === "turn.completed")).toMatchObject([
    { ok: true, stopReason: "cancelled" },
  ]);
});

it("fails a refused model change without sending the prompt", async () => {
  await instance.adapter.sendTurn({ threadId: "refused-model", text: "hello", model: "fixture/refused" });
  const completed = await events.until((event) => event.type === "turn.completed");
  expect(completed).toMatchObject({ ok: false, stopReason: "failed" });
  expect(events.events.some((event) => event.type === "runtime.error")).toBe(true);
  const rows = readFileSync(join(dir, "rpc.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  expect(rows.some((row) => "prompt" in row)).toBe(false);
  expect(events.events.some((event) => event.type === "session.started" && event.model === "fixture/refused")).toBe(false);
});

it.each([
  ["fixture/alias", "fixture/confirmed"],
  [undefined, "fixture/default"],
])("reports the confirmed model for selection %s", async (model, confirmed) => {
  await instance.adapter.sendTurn({ threadId: "confirmed-model", text: "hello", model });
  await events.until((event) => event.type === "turn.completed");
  expect(events.events.find((event) => event.type === "session.started")).toMatchObject({ model: confirmed });
});
