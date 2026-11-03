/** A wedged provider cannot keep the child alive, and a normal stop clears browser capabilities so no turn bearer outlives it. */
export function createGracefulShutdown({ cleanup, exit, timeoutMs = 6_000, }) {
    let started = false;
    return () => {
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
            exit(0);
        });
    };
}
