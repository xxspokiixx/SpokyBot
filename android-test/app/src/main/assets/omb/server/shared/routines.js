export const ROUTINE_CHECKS = ["calendar", "mail", "runs"];
export const ROUTINE_HOLD_CAUSES = ["plan_cancelled", "no_engine", "no_connections"];
/** The statuses both failure indicators count: a run that went wrong and has
 * not been acknowledged. */
export const ROUTINE_PROBLEM_STATUSES = ["failed", "missed"];
export function isRoutineProblemRun(run) {
    return ROUTINE_PROBLEM_STATUSES.includes(run.status);
}
