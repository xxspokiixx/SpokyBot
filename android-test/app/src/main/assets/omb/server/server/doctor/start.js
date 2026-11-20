// The doctor as a server starts: on the first start of a version (the version that last started is kept in
// doctor-state.json), after the folder's lease is this server's and before anything loads the registries or the
// messages. It applies the safe fixes, logs a line for each finding, and keeps a short summary for the health report. It
// never stops the server: the one thing that would make starting damage data, a newer data format, has already stopped
// it (data-format.ts), and anything that throws here is logged and passed over.
//
// On Android this matters most: the low-memory killer ends the server mid-save, so a leftover temp file or a half-written
// registry is a normal Tuesday, and there is no terminal where a person could run a repair by hand.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic.js";
import { reportLines, runDoctor } from "./run.js";
export const DOCTOR_STATE_FILE = "doctor-state.json";
let current = null;
export function doctorSummary() {
    return current;
}
function readState(dataDir) {
    try {
        const state = JSON.parse(readFileSync(join(dataDir, DOCTOR_STATE_FILE), "utf8"));
        return typeof state?.version === "string" && state.summary && typeof state.summary === "object" ? state : null;
    }
    catch {
        return null;
    }
}
export function summaryOf(report) {
    return {
        at: report.at,
        version: report.version,
        checked: report.counts.checked,
        fixed: report.checks.filter((result) => result.repaired).map((result) => result.id),
        problems: report.checks.filter((result) => result.status === "problem" || result.status === "failed").map((result) => result.id),
    };
}
export function doctorAtStart(dataDir, version, options = {}) {
    const log = options.log ?? ((line) => console.log(line));
    try {
        const state = readState(dataDir);
        if (state && state.version === version) {
            current = { ...state.summary, thisStart: false };
            return current;
        }
        const report = runDoctor({ ...options, dataDir, version, mode: "start", fix: true });
        const lines = reportLines(report);
        for (const line of lines)
            log(`[doctor] ${line}`);
        log(`[doctor] ${state ? `first start of ${version} (last: ${state.version})` : `first start of ${version}`}: ${report.counts.checked} checks, ${report.counts.fixed} fixed, ${report.counts.problems} need a person${report.backup ? `; what was changed was copied to ${report.backup} first` : ""}.`);
        const summary = summaryOf(report);
        current = { ...summary, thisStart: true };
        try {
            writeFileAtomic(join(dataDir, DOCTOR_STATE_FILE), `${JSON.stringify({ version, summary }, null, 2)}\n`, { mode: 0o600 });
        }
        catch (error) {
            log(`[doctor] could not record this version in ${DOCTOR_STATE_FILE} (${error instanceof Error ? error.message : String(error)}); it runs again at the next start.`);
        }
        return current;
    }
    catch (error) {
        log(`[doctor] did not run: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}
