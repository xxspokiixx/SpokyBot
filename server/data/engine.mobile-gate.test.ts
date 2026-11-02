// Never runs where the data surface must work: every case either refuses the binding, or proves the desktop path unbroken.
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { compileChart } from "./chart-compiler.ts";
import { createDataEngine, mobileRefusal, type DataEngineOptions } from "./engine.ts";
import { chartRenderer } from "./render.ts";
import { DataFailure, type DataEngine } from "./types.ts";

const root = mkdtempSync(join(tmpdir(), "omb-data-mobile-gate-"));
const engines: DataEngine[] = [];

function engine(overrides: Partial<DataEngineOptions> = {}): DataEngine {
  const created = createDataEngine({
    botFolder: (botId) => join(root, "bots", botId),
    dataDir: join(root, "data"),
    env: {},
    ...overrides,
  });
  engines.push(created);
  return created;
}

async function failure(promise: Promise<unknown>): Promise<DataFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DataFailure) return error;
    throw error;
  }
  throw new Error("expected a DataFailure");
}

async function withPlatform<T>(platform: string, run: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { ...descriptor, value: platform });
  return run().finally(() => Object.defineProperty(process, "platform", descriptor));
}

afterAll(async () => {
  // DuckDB's native close blocks the worker thread on Windows; process exit reclaims the handles.
  if (process.platform === "win32") return;
  await Promise.all(engines.map((e) => e.closeAll()));
  await rm(root, { recursive: true, force: true });
});

describe("mobileRefusal", () => {
  it("one string for both triggers, nothing for the desktop platforms", () => {
    const refusal = mobileRefusal("android", {});
    expect(refusal).toMatch(/android/);
    expect(mobileRefusal("win32", { OMB_MOBILE: "1" })).toBe(refusal);
    for (const platform of ["win32", "darwin", "linux"]) expect(mobileRefusal(platform, {})).toBeNull();
    expect(mobileRefusal()).toBeNull();
  });
});

describe("the mobile gate", () => {
  it("refuses android before the binding is ever required, though node_modules holds a loadable one", async () => {
    const e = engine();
    await withPlatform("android", async () => {
      const reason = e.unavailable();
      expect(reason).toBe(mobileRefusal("android", {}));
      const error = await failure(e.forBot("mobile-platform"));
      expect(error.error.code).toBe("engine_unavailable");
      expect(error.error.message).toBe(reason);
    });
  });

  it("refuses on OMB_MOBILE=1 with the desktop platform untouched", async () => {
    const e = engine({ env: { OMB_MOBILE: "1" } });
    const error = await failure(e.forBot("mobile-flag"));
    expect(error.error.code).toBe("engine_unavailable");
    expect(e.unavailable()).toBe(mobileRefusal(process.platform, { OMB_MOBILE: "1" }));
  });

  it("refuses a PNG render before resvg is required", async () => {
    const source = [{ name: "region", type: "VARCHAR" }, { name: "amount", type: "DECIMAL(10,2)" }];
    const { vegaLite } = compileChart({ type: "bar", x: "region", y: "amount" }, source, "sales");
    const columns = [{ name: "x", type: "VARCHAR" }, { name: "y", type: "DECIMAL(38,2)" }];
    const error = await failure(withPlatform("android", () => chartRenderer.png(vegaLite, [["north", "1200"]], columns, { theme: "light" })));
    expect(error.error.code).toBe("engine_unavailable");
  });
});

describe("desktop unchanged", () => {
  it("loads the binding and answers a run when neither trigger is set", async () => {
    const e = engine();
    expect(e.unavailable()).toBeNull();
    const db = await e.forBot("gate-desktop");
    expect((await db.run("SELECT 1 AS one", { connection: "bot" })).rows).toEqual([[1]]);
  });
});
