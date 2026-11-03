// Routines and runs as routines.json holds them, read back into the shapes RoutineManager works with: anything a hand
// edit or an older version left out of range is dropped, never trusted.
import { z } from "zod";
import { ROUTINE_CHECKS } from "../shared/routines.js";
import { ROUTINE_PARTS } from "./package-parts.js";
import { loadAttachments, loadTimeoutMinutes } from "./routine-attachments.js";
import { MAX_DATE_MS } from "./routine-intervals.js";
import { loadSchedule } from "./routine-schedules.js";
const persistedSourceThreadId = z.string().trim().min(1).optional().catch(undefined);
const HASH = /^[a-f0-9]{64}$/;
export function loadInstalledPackage(value) {
    if (!value || typeof value !== "object")
        return undefined;
    const stamp = value;
    if (typeof stamp.installId !== "string" || !/^[a-f0-9]{32}$/.test(stamp.installId) || typeof stamp.key !== "string" || !stamp.key || stamp.key.length > 80)
        return undefined;
    const parts = stamp.parts;
    if (!parts || typeof parts !== "object" || !ROUTINE_PARTS.every((part) => HASH.test(String(parts[part]?.r)) && HASH.test(String(parts[part]?.w))))
        return undefined;
    return {
        installId: stamp.installId,
        key: stamp.key,
        parts: Object.fromEntries(ROUTINE_PARTS.map((part) => [part, { r: parts[part].r, w: parts[part].w }])),
    };
}
function loadTarget(value) {
    return value === "room-goal" ? "room-goal" : "bot";
}
const ROUTINE_GOAL_STATUSES = new Set([
    "completed",
    "needs-input",
    "blocked",
    "limit-reached",
    "paused",
    "stopped",
    "failed",
]);
function loadGoalStatus(value, target) {
    return target === "room-goal" && typeof value === "string" && ROUTINE_GOAL_STATUSES.has(value)
        ? value
        : undefined;
}
function loadGroupId(value, target) {
    if (target !== "room-goal" || typeof value !== "string")
        return undefined;
    return value.trim() || undefined;
}
/** Known checks, each once, in their own order; undefined when none. */
export function loadChecks(value) {
    if (!Array.isArray(value))
        return undefined;
    const checks = ROUTINE_CHECKS.filter((check) => value.includes(check));
    return checks.length ? checks : undefined;
}
/** A routine's checks, access and delivery as it may hold them; a field out of range is left out. */
export function withCheckFields(routine) {
    const clean = { ...routine, checks: routine.target === "bot" ? loadChecks(routine.checks) : undefined,
        access: routine.access === "read-and-draft" ? "read-and-draft" : undefined,
        deliver: routine.target === "bot" && routine.deliver === "brief" ? "brief" : undefined };
    return withoutUndefined(clean, ["checks", "access", "deliver"]);
}
const instant = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE_MS ? value : undefined;
function withoutUndefined(record, keys) {
    for (const key of keys)
        if (record[key] === undefined)
            delete record[key];
    return record;
}
/** Null when its schedule cannot load: the caller keeps it on disk, unscheduled. */
export function loadRoutine(routine, now) {
    const schedule = loadSchedule(routine.schedule, now);
    if (!schedule)
        return null;
    const target = loadTarget(routine.target);
    const loaded = {
        ...routine,
        schedule,
        target,
        groupId: loadGroupId(routine.groupId, target),
        runOn: routine.runOn ?? "maus",
        timeoutMinutes: loadTimeoutMinutes(routine.timeoutMinutes),
        attachments: loadAttachments(routine.attachments),
        sourceThreadId: persistedSourceThreadId.parse(routine.sourceThreadId),
        resultsThreadId: persistedSourceThreadId.parse(routine.resultsThreadId),
        overlap: routine.overlap === "queue" ? "queue" : undefined,
        runOnStartup: routine.runOnStartup === true ? true : undefined,
        skippedRuns: Number.isSafeInteger(routine.skippedRuns) && routine.skippedRuns > 0 ? routine.skippedRuns : undefined,
        lastSkippedAt: Number.isSafeInteger(routine.lastSkippedAt) && routine.lastSkippedAt >= 0 && routine.lastSkippedAt <= MAX_DATE_MS ? routine.lastSkippedAt : undefined,
        installedPackage: loadInstalledPackage(routine.installedPackage),
        checkedAt: instant(routine.checkedAt),
        checkTrouble: typeof routine.checkTrouble === "string" && routine.checkTrouble ? routine.checkTrouble.slice(0, 300) : undefined,
        wakeAt: instant(routine.wakeAt),
    };
    delete loaded.failureStreak;
    return withCheckFields(withoutUndefined(loaded, ["timeoutMinutes", "runOnStartup", "installedPackage", "checkedAt", "checkTrouble", "wakeAt"]));
}
export function loadRun(run) {
    const target = loadTarget(run.target);
    const loaded = {
        ...run,
        target,
        goalStatus: loadGoalStatus(run.goalStatus, target),
        groupId: loadGroupId(run.groupId, target),
        runOn: run.runOn ?? "maus",
        timeoutMinutes: loadTimeoutMinutes(run.timeoutMinutes),
        attachments: loadAttachments(run.attachments),
        sourceThreadId: persistedSourceThreadId.parse(run.sourceThreadId),
        resultsThreadId: persistedSourceThreadId.parse(run.resultsThreadId),
        access: run.access === "read-and-draft" ? "read-and-draft" : undefined,
        deliver: run.deliver === "brief" ? "brief" : undefined,
        checkKey: typeof run.checkKey === "string" && /^[\w-]{1,128}$/.test(run.checkKey) ? run.checkKey : undefined,
    };
    return withoutUndefined(loaded, ["timeoutMinutes", "access", "deliver", "checkKey"]);
}
