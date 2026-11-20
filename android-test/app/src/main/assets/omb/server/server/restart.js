// The exit codes a server uses to ask its launcher for a fresh start (75, after a restore commits), and to say it could
// not survive an error (70, server/crash-guard.ts). Every launcher reads the same policy.
export const RESTART_EXIT_CODE = 75;
export const CRASH_EXIT_CODE = 70;
export const MAX_RESTARTS = 5;
export const STABLE_RUN_MS = 60_000;
/** The pause before each start after a crash in a row: a crash loop slows down, then stops at the last. */
export const CRASH_BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000];
/** Killed by the system rather than asked to stop: out of memory (SIGKILL, SIGABRT), or a fault. Shells and
 * containers report these as 128 + the signal's number. */
const CRASH_SIGNALS = new Set(["SIGKILL", "SIGABRT", "SIGSEGV", "SIGBUS", "SIGILL", "SIGFPE"]);
const CRASH_CODES = new Set([CRASH_EXIT_CODE, 134, 135, 136, 137, 139]);
export const crashed = (code, signal) => code === null ? Boolean(signal && CRASH_SIGNALS.has(signal)) : CRASH_CODES.has(code);
/**
 * One rule for every launcher. A server that asks for a restart (75) starts again at once, at most MAX_RESTARTS in a
 * row. A server that crashed starts again after CRASH_BACKOFF_MS[n], at most that many times in a row; any other exit
 * (0, a refused start, a person stopping it) ends the launcher. A run that stayed up STABLE_RUN_MS starts both counts
 * again.
 */
export function restartPolicy(now = Date.now) {
    let restarts = 0, crashes = 0, startedAt = now(), delay = 0;
    return {
        again(code, stopping = false, signal) {
            if (now() - startedAt >= STABLE_RUN_MS) {
                restarts = 0;
                crashes = 0;
            }
            delay = 0;
            if (stopping)
                return false;
            if (code === RESTART_EXIT_CODE) {
                if (restarts >= MAX_RESTARTS)
                    return false;
                restarts++;
            }
            else if (crashed(code, signal)) {
                if (crashes >= CRASH_BACKOFF_MS.length)
                    return false;
                delay = CRASH_BACKOFF_MS[crashes++];
            }
            else
                return false;
            startedAt = now() + delay;
            return true;
        },
        /** How long to wait before the start the last again() allowed. */
        delayMs: () => delay,
    };
}
/** What a launcher says before starting the server again. */
export const restartLine = (code, delayMs) => code === RESTART_EXIT_CODE
    ? "SpokyBot is starting again to finish installing a copy from the desktop app…"
    : `SpokyBot stopped unexpectedly (${code ?? "killed"}); starting it again in ${Math.round(delayMs / 1000)} s…`;
