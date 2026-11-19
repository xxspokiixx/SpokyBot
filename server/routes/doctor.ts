// GET /api/diagnostics/doctor: the last start's findings. POST /api/diagnostics/doctor with {"fix":true}: a run now,
// with the safe repairs. This is the doctor's command surface on a phone, where there is no terminal to run it in: the
// repairs are confined to the data folder, skip a folder a server is using, and copy what they change first.
import type { DoctorCheck } from "../doctor/types.ts";
import { reportLines, runDoctor } from "../doctor/run.ts";
import { summaryOf } from "../doctor/start.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const DOCTOR_PATH = "/api/diagnostics/doctor";

export interface DoctorRouteDeps {
  dataDir: string;
  version(): string;
  isAdmin(auth: RequestAuth): boolean;
  /** The checks, and the clock, so a test drives the route without a real server. */
  checks?: DoctorCheck[];
  now?: () => number;
}

export function createDoctorRoutes(deps: DoctorRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== DOCTOR_PATH) return PASS;
    if (!deps.isAdmin(auth)) return json(res, 403, { error: "Only the owner or an admin can run the doctor." });
    res.setHeader("Cache-Control", "no-store");
    if (method === "GET") {
      const report = runDoctor({ dataDir: deps.dataDir, version: deps.version(), mode: "command", fix: false, ...(deps.checks ? { checks: deps.checks } : {}), ...(deps.now ? { now: deps.now } : {}) });
      return json(res, 200, { report, summary: summaryOf(report), lines: reportLines(report) });
    }
    if (method !== "POST") return json(res, 405, { error: "Use GET to look, or POST with {\"fix\":true} to repair." });
    const body = await readBody(req).catch(() => null) as { fix?: unknown } | null;
    // Repairs are asked for explicitly: a plain POST only looks.
    const fix = body?.fix === true;
    const report = runDoctor({ dataDir: deps.dataDir, version: deps.version(), mode: "command", fix, ...(deps.checks ? { checks: deps.checks } : {}), ...(deps.now ? { now: deps.now } : {}) });
    return json(res, 200, { report, summary: summaryOf(report), lines: reportLines(report) });
  };
}
