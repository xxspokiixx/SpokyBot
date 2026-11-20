/** Above the engines' kill path (0.5 s after end of input, 1.5 s after SIGTERM, 1 s after SIGKILL) and the browsers'
 * close, and below the desktop app's and the Android shell's wait for the server. */
export const SHUTDOWN_DEADLINE_MS = 8_000;
/** A wedged provider cannot keep the child alive, and a normal stop clears browser capabilities so no turn bearer outlives it. */
export function createGracefulShutdown({ cleanup, exit, timeoutMs = SHUTDOWN_DEADLINE_MS, }) {
    let started = false;
    /** `code`: what the process exits with once closed (server/crash-guard.ts passes CRASH_EXIT_CODE); 0 by default. */
    return (code = 0) => {
        if (started)
            return;
        started = true;
        let timer;
        const deadline = new Promise((resolve) => {
            timer = setTimeout(resolve, timeoutMs);
            timer.unref?.();
        });
        const settled = Promise.allSettled(cleanup.map((job) => Promise.resolve().then(job)))
            .then(() => undefined);
        void Promise.race([settled, deadline]).finally(() => {
            if (timer)
                clearTimeout(timer);
            exit(code);
        });
    };
}
