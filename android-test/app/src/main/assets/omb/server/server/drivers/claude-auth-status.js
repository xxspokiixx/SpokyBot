import { CLI_PROBE_TIMEOUT_MS, execCli } from "../procs.js";
/** Whether `claude` is signed in, per the CLI's own `auth status`: credential storage varies by
 * platform (Keychain, a JSON file) and presence checks accept stale credentials. A check that
 * timed out (a Keychain prompt left open) says nothing, so `authenticated` is left out. */
export function claudeAuthStatus(cli, env, run = execCli) {
    return new Promise((resolve) => {
        run(cli, ["auth", "status", "--json"], { timeout: CLI_PROBE_TIMEOUT_MS, maxBuffer: 65_536, env }, (error, stdout) => {
            if (error?.killed)
                return resolve({});
            try {
                const status = JSON.parse(stdout);
                if (!status || typeof status !== "object" || !("loggedIn" in status) || status.loggedIn !== true) {
                    return resolve({ authenticated: false });
                }
                const identity = status;
                const boundedText = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\p{Cc}\p{Cf}]/u.test(value)
                    ? value.trim() : undefined;
                const candidateEmail = boundedText(identity.email, 254);
                const email = candidateEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail) ? candidateEmail : undefined;
                const organization = boundedText(identity.orgName, 160);
                const account = {
                    ...(email ? { email } : {}),
                    ...(organization ? { organization } : {}),
                    ...(identity.authMethod === "api_key" ? { method: "api-key" } : {}),
                };
                resolve({ authenticated: true, ...(Object.keys(account).length ? { account } : {}) });
            }
            catch {
                resolve({ authenticated: false });
            }
        });
    });
}
export async function claudeSignedIn(cli, env, run = execCli) {
    return (await claudeAuthStatus(cli, env, run)).authenticated === true;
}
