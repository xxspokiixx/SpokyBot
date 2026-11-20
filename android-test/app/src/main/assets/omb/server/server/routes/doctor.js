import { reportLines, runDoctor } from "../doctor/run.js";
import { summaryOf } from "../doctor/start.js";
import { PASS } from "./table.js";
export const DOCTOR_PATH = "/api/diagnostics/doctor";
export function createDoctorRoutes(deps) {
    return async ({ req, res, path, method, auth, json, readBody }) => {
        if (path !== DOCTOR_PATH)
            return PASS;
        if (!deps.isAdmin(auth))
            return json(res, 403, { error: "Only the owner or an admin can run the doctor." });
        res.setHeader("Cache-Control", "no-store");
        if (method === "GET") {
            const report = runDoctor({ dataDir: deps.dataDir, version: deps.version(), mode: "command", fix: false, ...(deps.checks ? { checks: deps.checks } : {}), ...(deps.now ? { now: deps.now } : {}) });
            return json(res, 200, { report, summary: summaryOf(report), lines: reportLines(report) });
        }
        if (method !== "POST")
            return json(res, 405, { error: "Use GET to look, or POST with {\"fix\":true} to repair." });
        const body = await readBody(req).catch(() => null);
        // Repairs are asked for explicitly: a plain POST only looks.
        const fix = body?.fix === true;
        const report = runDoctor({ dataDir: deps.dataDir, version: deps.version(), mode: "command", fix, ...(deps.checks ? { checks: deps.checks } : {}), ...(deps.now ? { now: deps.now } : {}) });
        return json(res, 200, { report, summary: summaryOf(report), lines: reportLines(report) });
    };
}
