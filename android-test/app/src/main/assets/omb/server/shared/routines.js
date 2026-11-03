export const ROUTINE_CHECKS = ["calendar", "mail", "runs"];
/** The statuses both failure indicators count: a run that went wrong and has
 * not been acknowledged. */
export const ROUTINE_PROBLEM_STATUSES = ["failed", "missed"];
export function isRoutineProblemRun(run) {
    return ROUTINE_PROBLEM_STATUSES.includes(run.status);
}
