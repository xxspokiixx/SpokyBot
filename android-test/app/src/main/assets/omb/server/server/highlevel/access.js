// Per-bot checks for HighLevel calls, the same rules Composio calls get: connectorTools grants decide which tools,
// connectorScopes.apps.highlevel decides read or write. A refusal names the bot and the app, never the other grants.
import { HIGHLEVEL_SLUG } from "../../shared/highlevel.js";
import { connectorAccessDecision, describeConnectorScopes } from "../../shared/connector-scopes.js";
import { connectorRefusalText, connectorScopeRefusalText, evaluateConnectorTools } from "../connector-verdict.js";
import { HIGHLEVEL_PROMPT } from "./instructions.js";
/** Does this bot get the HighLevel tools at all? Off with connected apps off, or with a scope or grant record that leaves HighLevel out. */
export function highlevelAllowedFor(bot) {
    if (bot.composio === false)
        return false;
    if (bot.connectorScopes && !Object.hasOwn(bot.connectorScopes.apps, HIGHLEVEL_SLUG))
        return false;
    if (bot.connectorTools !== undefined && !Object.hasOwn(bot.connectorTools, HIGHLEVEL_SLUG))
        return false;
    return true;
}
/** tools/list shows only what a call would be allowed to run. */
export function highlevelToolVisible(bot, name) {
    return highlevelAccess(bot, name).ok;
}
/** The verdict for one call, with the decision rows the handler writes. */
export function highlevelAccess(bot, name) {
    const rows = [];
    if (!highlevelAllowedFor(bot)) {
        rows.push({ tool: name, summary: "HighLevel is not enabled for this bot", decision: "auto-denied", rule: `scope:${HIGHLEVEL_SLUG}:app` });
        return { ok: false, text: connectorScopeRefusalText({ kind: "tools", invoked: name, names: [name] }, "app", bot.name, "HighLevel", describeAction(name)), rows };
    }
    const verdict = evaluateConnectorTools([name], bot.connectorTools, [HIGHLEVEL_SLUG]);
    if (!verdict.allowed) {
        for (const denial of verdict.denials) {
            rows.push({ tool: denial.tool, summary: denial.onGrantedService ? "tool is not in this service's grant" : "service is not granted", decision: "auto-denied", rule: `connectorTools.${HIGHLEVEL_SLUG}` });
        }
        return { ok: false, text: connectorRefusalText(verdict.denials), rows };
    }
    const access = connectorAccessDecision(bot.connectorScopes, [{ slug: name }], [HIGHLEVEL_SLUG]);
    if (!access.ok) {
        rows.push({ tool: name, decision: "auto-denied", rule: `scope:${HIGHLEVEL_SLUG}:${access.reason}` });
        return { ok: false, text: connectorScopeRefusalText({ kind: "tools", invoked: name, names: [name] }, access.reason, bot.name, "HighLevel", describeAction(name)), rows };
    }
    rows.push({ tool: name, summary: `allowed ${name}`, decision: "auto-approved", rule: verdict.legacy ? `scope:${HIGHLEVEL_SLUG}` : verdict.rule });
    return { ok: true, rows };
}
/** HIGHLEVEL_ADD_NOTE → "Add note". */
export function describeAction(name) {
    const action = name.replace(/^HIGHLEVEL_/u, "").replace(/_+/gu, " ").toLowerCase();
    return action ? action[0].toUpperCase() + action.slice(1) : name;
}
/** The system prompt part: what the bot can do, that it never messages anyone, and its HighLevel scope. */
export function highlevelSystemPrompt(bot) {
    const scopes = bot.connectorScopes ? { apps: { [HIGHLEVEL_SLUG]: bot.connectorScopes.apps[HIGHLEVEL_SLUG] } } : undefined;
    const grant = bot.connectorTools?.[HIGHLEVEL_SLUG];
    const granted = grant && grant.tools !== "*" ? ` Of the highlevel tools, this bot was granted only: ${grant.tools.join(", ")}.` : "";
    return HIGHLEVEL_PROMPT + granted + describeConnectorScopes(scopes);
}
