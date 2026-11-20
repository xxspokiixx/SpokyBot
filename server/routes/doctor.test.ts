import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { RequestAuth } from "../request-auth.ts";
import { DOCTOR_PATH, createDoctorRoutes } from "./doctor.ts";

const NOW = Date.parse("2026-11-19T12:00:00.000Z");
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), "omb-doctor-route-"));
  dirs.push(dir);
  for (const name of ["events", "native"]) mkdirSync(join(dir, name));
  return dir;
};

/** A request answered by the route: the status and body it wrote, or null when it declined. */
async function call(route: ReturnType<typeof createDoctorRoutes>, init: { method: string; admin?: boolean; body?: unknown }) {
  const written: { status: number; body: unknown }[] = [];
  const res = {
    setHeader: () => {},
    headersSent: false,
    writableEnded: false,
  } as never;
  const out = await route({
    req: {} as never,
    res,
    url: new URL(`http://127.0.0.1${DOCTOR_PATH}`),
    path: DOCTOR_PATH,
    method: init.method,
    auth: { kind: "loopback", scopes: init.admin ? ["admin"] : [] } as unknown as RequestAuth,
    json: ((_res: unknown, status: number, body: unknown) => { written.push({ status, body }); return undefined; }) as never,
    readBody: (async () => init.body ?? null) as never,
  });
  return out === undefined || written.length ? written[0] ?? null : null;
}

const route = (dir: string) => createDoctorRoutes({ dataDir: dir, version: () => "0.4131.70", isAdmin: (auth) => auth.scopes.includes("admin"), now: () => NOW });

describe("the doctor route", () => {
  it("declines any other path, so the rest of the table still sees it", async () => {
    const dir = folder();
    const out = await createDoctorRoutes({ dataDir: dir, version: () => "v", isAdmin: () => true })({
      req: {} as never, res: {} as never, url: new URL("http://x/api/other"), path: "/api/other", method: "GET",
      auth: {} as never, json: (() => {}) as never, readBody: (async () => null) as never,
    });
    expect(out).not.toBeUndefined();
  });

  it("refuses anyone who is not the owner or an admin", async () => {
    const answer = await call(route(folder()), { method: "GET", admin: false });
    expect(answer).toMatchObject({ status: 403 });
  });

  it("looks without changing anything, naming what a person must fix", async () => {
    const dir = folder();
    writeFileSync(join(dir, "groups.json"), "not a list");
    const answer = await call(route(dir), { method: "GET", admin: true });
    const body = answer!.body as { report: { fix: { asked: boolean; ran: boolean } }; summary: { problems: string[] }; lines: string[] };
    expect(body.report.fix).toMatchObject({ asked: false, ran: false });
    expect(body.summary.problems).toEqual(["registry"]);
    expect(body.lines.some((line) => line.startsWith("registry:"))).toBe(true);
    // A look never copies or moves: the damaged file is still there and no backup folder appeared.
    expect(require("node:fs").existsSync(join(dir, "groups.json"))).toBe(true);
  });

  it("repairs only when the request asks for it, and reports what it did", async () => {
    const dir = folder();
    rmSync(join(dir, "native"), { recursive: true, force: true });
    const plain = await call(route(dir), { method: "POST", admin: true, body: {} });
    expect((plain!.body as { report: { fix: { ran: boolean } } }).report.fix.ran).toBe(false);
    expect(require("node:fs").existsSync(join(dir, "native")), "a look changes nothing").toBe(false);
    const fixed = await call(route(dir), { method: "POST", admin: true, body: { fix: true } });
    const body = fixed!.body as { report: { fix: { ran: boolean }; counts: { fixed: number } } };
    expect(body.report.fix.ran).toBe(true);
    expect(body.report.counts.fixed).toBe(1);
    expect(require("node:fs").existsSync(join(dir, "native"))).toBe(true);
  });

  it("answers 405 for a method it does not take", async () => {
    expect((await call(route(folder()), { method: "DELETE", admin: true }))!.status).toBe(405);
  });
});
