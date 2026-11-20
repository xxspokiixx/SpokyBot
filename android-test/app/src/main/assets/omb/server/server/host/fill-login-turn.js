import { BROWSER_CONTROL_REFUSAL } from "../browser-runtime.js";
import { fillLogin } from "../login-fill.js";
import { redactSecretsInText } from "../redact.js";
import { surfaceLabel } from "../surface.js";
const ONLY_IN_BROWSER = "fill_login types a password only into a page of your own browser, where SpokyBot checks the page's site first";
export function createFillLoginTurn(deps) {
    // Security: on a screen the server cannot prove which site a focused box belongs to, so a secret is never typed there.
    function elsewhere(bot, turn, place) {
        const current = deps.current(bot, turn.threadId);
        const where = place ? surfaceLabel(place) : null;
        const notHere = where ? `; it never types one on the screen of ${where}` : "";
        const signIn = where ? `Call request_sign_in so the person signs in on ${where}.` : "Call request_sign_in instead.";
        if (!deps.browserSelectable(current)) {
            const why = current.browser === false || current.computer === "off" || !deps.builtInBrowserOn()
                ? "the built-in browser is off for you here"
                : "your browser is not available here: it is not installed yet, or this AI model cannot use browser tools";
            return { ok: false, text: where ? `${ONLY_IN_BROWSER}${notHere}, and ${why}. ${signIn}` : `fill_login works in the built-in browser, and this conversation has none. ${signIn}` };
        }
        if (!deps.logins.sitesFor(bot.id).length) {
            const trouble = deps.onePasswordTrouble();
            return { ok: false, text: `You have no saved logins to fill${trouble ? ` (1Password could not be read just now: ${trouble})` : ""}. ${signIn}` };
        }
        if (!deps.moveToBrowser(turn)) {
            return { ok: false, text: `${ONLY_IN_BROWSER}${notHere}, and this run cannot move to your browser. ${signIn} For runs like this to sign in by themselves, the person can choose Browser under where this bot works.` };
        }
        const chrome = deps.myChrome(current) ? ", which is the person's own Chrome (My Chrome), signed in as them" : "";
        return { ok: false, text: `${ONLY_IN_BROWSER}${notHere}. SpokyBot is moving this conversation to your own browser${chrome}. End this turn now without using the screen tools: the request continues there with your browser tools. Open the site's sign-in page in that browser, then call fill_login.` };
    }
    async function fillLoginForTurn(bot, capability, rawUsername, rawSubmit) {
        const threadId = capability.threadId;
        const place = deps.place(bot, threadId);
        if (place !== "browser")
            return elsewhere(bot, capability, place);
        const current = deps.current(bot, threadId);
        if (current.browser === false || current.computer === "off" || !deps.builtInBrowserOn()) {
            return { ok: false, text: "The built-in browser is off for you here, so fill_login has nothing to fill. Call request_sign_in instead." };
        }
        const browser = await deps.target(current, threadId);
        if (!browser)
            return { ok: false, text: "The browser is not available on this computer right now. Call request_sign_in instead." };
        const { session, spec, env } = browser;
        if (!deps.claim(capability, `browser:${session}`)) {
            return { ok: false, text: "Another conversation is using this browser. Wait until it finishes, then call fill_login again." };
        }
        const username = typeof rawUsername === "string" ? rawUsername.slice(0, 512) : undefined;
        try {
            const outcome = await deps.withSecretInput(session, spec, () => fillLogin({
                username,
                submit: rawSubmit !== false,
                candidates: (host) => deps.logins.candidates(bot.id, host),
                available: async () => deps.logins.sitesFor(bot.id),
                trouble: deps.onePasswordTrouble,
            }, {
                ...deps.loginInput(session, spec, env),
                remember: deps.remember,
            }), deps.stepContext(current, capability));
            if (outcome.ok && outcome.loginId)
                deps.logins.markUsed(outcome.loginId);
            return { ok: outcome.ok, text: outcome.text };
        }
        catch (error) {
            if (error instanceof Error && error.message === BROWSER_CONTROL_REFUSAL) {
                return { ok: false, text: "The person is using this browser right now. Wait for them to hand it back, then call fill_login again." };
            }
            const reason = error instanceof Error ? error.message : String(error);
            return { ok: false, text: `Could not fill the login: ${redactSecretsInText(reason)} Call request_sign_in if it keeps failing.` };
        }
    }
    return { fillLoginForTurn };
}
