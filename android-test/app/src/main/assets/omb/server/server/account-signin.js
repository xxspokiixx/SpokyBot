// Email sign-in through the SpokyBot control plane: the code exchange is server-side, so a browser only talks to this
// server, and a server with an empty allow-list does not expose the routes. The result is an ordinary local session.
import { resolveCompanionControlPlaneURL } from "../electron/companion-account-service.mjs";
import { ControlPlaneError, createControlPlaneClient, normalizeAccountEmail } from "../electron/control-plane-client.mjs";
/** Commas, spaces or newlines between entries; case does not matter. */
export function parseAllowList(value) {
    return (value ?? "")
        .split(/[,\s]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
}
export function allowedScopes(rawEmail, list) {
    const email = rawEmail.trim().toLowerCase();
    if (!email.includes("@"))
        return null;
    const matches = (entry) => (entry.startsWith("@") ? email.endsWith(entry) && email.length > entry.length : entry === email);
    if (list.admins.some(matches))
        return ["admin", "client"];
    if (list.members.some(matches))
        return ["client"];
    return null;
}
export function signInEnabled(list) {
    return list.admins.length + list.members.length > 0;
}
const NOT_WELCOME = { ok: false, status: 403, error: "this email is not on this server's sign-in list; ask the server's owner to add it" };
export function createEmailSignIn(options) {
    const env = options.env ?? process.env;
    const allow = () => (typeof options.allow === "function" ? options.allow() : options.allow);
    let client = options.client ?? null;
    const controlPlane = () => {
        if (client)
            return client;
        const url = resolveCompanionControlPlaneURL({ isPackaged: true, environment: env });
        if (!url)
            throw new Error("OMB_CONTROL_PLANE_URL is set but is not an https address");
        client = createControlPlaneClient({ baseURL: url, fetchImpl: options.fetchImpl });
        return client;
    };
    return {
        enabled: () => signInEnabled(allow()),
        async start(rawEmail) {
            const email = normalizeAccountEmail(rawEmail);
            if (!email)
                return { ok: false, status: 400, error: "enter a valid email address" };
            if (!allowedScopes(email, allow()))
                return NOT_WELCOME;
            try {
                await controlPlane().requestOTP(email);
            }
            catch (error) {
                return unavailable(error);
            }
            return { ok: true };
        },
        async verify(rawEmail, code) {
            const email = normalizeAccountEmail(rawEmail);
            if (!email || !allowedScopes(email, allow()))
                return NOT_WELCOME;
            let verified;
            try {
                verified = await controlPlane().verifyOTP(email, code);
            }
            catch (error) {
                // The client refuses a malformed code before any request (status 0);
                // the control plane's own "invalid_otp" is a wrong or expired code.
                if (error instanceof ControlPlaneError && error.code === "invalid_otp" && !error.status) {
                    return { ok: false, status: 400, error: "enter the 8-digit code from the email" };
                }
                if (error instanceof ControlPlaneError && error.status === 429) {
                    return { ok: false, status: 429, error: "too many attempts; wait a minute and request a new code" };
                }
                if (error instanceof ControlPlaneError && (error.status === 400 || error.status === 401 || error.status === 403)) {
                    return { ok: false, status: 401, error: "that code is wrong or has expired; request a new one" };
                }
                return unavailable(error);
            }
            void controlPlane()
                .signOut(verified.accountToken)
                .catch(() => undefined);
            const scopes = allowedScopes(verified.user.email, allow());
            if (!scopes)
                return NOT_WELCOME;
            return { ok: true, email: verified.user.email, userId: verified.user.id, scopes };
        },
    };
}
function unavailable(error) {
    const detail = error instanceof ControlPlaneError ? `${error.code}${error.status ? ` (${error.status})` : ""}` : error instanceof Error ? error.message : String(error);
    return { ok: false, status: 502, error: `the sign-in service could not be reached (${detail}); try again in a moment` };
}
