// What a bot may read about the usage limits of the AI accounts it can run on: percent used, reset time and when that was
// checked, per account. Rows are built field by field from the plan-usage report, so no token, account id, sign-in folder
// or address can reach a model. Security: an account kept in another person's engine home is never listed to a turn.
import { join, relative, isAbsolute } from "node:path";
import { audienceMember } from "./audience.js";
import { audienceHomeKey, engineHomesRoot } from "./engine-homes/layout.js";
const REPORTING_DRIVERS = new Set(["claudeAgent", "codex", "grokAgent"]);
const UNSUPPORTED_WHY = "This AI does not report usage limits to this app.";
const NO_WINDOWS_WHY = "The account answered but reported no usage windows.";
const NOT_CHECKED_WHY = "Usage could not be checked just now. Try again later.";
function under(root, path) {
    const inside = relative(root, path);
    return inside && !inside.startsWith("..") && !isAbsolute(inside) ? inside.split(/[\\/]/)[0] : null;
}
function accountFolders(entry) {
    const configDir = entry?.config?.configDir;
    return [configDir, ...Object.values(entry?.environment ?? {})].filter((value) => typeof value === "string" && isAbsolute(value));
}
/** Engine sign-ins on a Team Cloud are the team's: only an Admin saves one, and it serves every member. The one way an
 * account is someone's own is its folder sitting in their engine home or person folder. */
export function accountReadableFrom(entry, turn, dataDir) {
    const homes = engineHomesRoot(dataDir), people = join(dataDir, "people");
    return accountFolders(entry).every((folder) => {
        const home = under(homes, folder);
        if (home !== null && home !== "team" && home !== audienceHomeKey(turn))
            return false;
        const person = under(people, folder);
        return person === null || person === audienceMember(turn);
    });
}
const percent = (value) => Math.round(value * 10) / 10;
function rowWindows(row) {
    const line = (name, window) => window.available && window.usedPercent !== null
        ? [{ name, usedPercent: percent(window.usedPercent), resetsAt: window.resetsAt }] : [];
    return [
        ...line("5-hour", row.fiveHour),
        ...line("weekly", row.weekly),
        ...row.extra.map((extra) => ({ name: extra.label, usedPercent: percent(extra.usedPercent), resetsAt: extra.resetsAt })),
        ...row.models.flatMap((model) => model.windows.map((entry) => ({ name: `${model.name} ${entry.label}`, usedPercent: percent(entry.usedPercent), resetsAt: entry.resetsAt }))),
    ];
}
/** A person may have named an account after their address. */
const shownName = (instance) => {
    const name = instance.displayName?.trim();
    return name && !name.includes("@") ? name : instance.driverKind;
};
export function engineLimitsFor(input) {
    const { report } = input;
    const seen = new Map();
    return input.instances.flatMap((instance) => {
        const snapshot = input.status(instance.instanceId);
        if (!instance.enabled || snapshot?.state !== "available")
            return [];
        if (!accountReadableFrom(input.configs[instance.instanceId], input.turn, input.dataDir))
            return [];
        const base = (() => {
            const name = shownName(instance), count = (seen.get(name) ?? 0) + 1;
            seen.set(name, count);
            return { account: count > 1 ? `${name} ${count}` : name, engine: instance.driverKind };
        })();
        if (!REPORTING_DRIVERS.has(instance.driverKind) || snapshot.billing === "metered") {
            return snapshot.authenticated === false ? [] : [{ ...base, status: "unsupported", checkedAt: null, windows: [], why: UNSUPPORTED_WHY }];
        }
        if (!report)
            return [{ ...base, status: "unknown", checkedAt: null, windows: [], why: NOT_CHECKED_WHY }];
        const row = report.providers.find((candidate) => candidate.id === instance.instanceId);
        if (!row)
            return [{ ...base, status: "unsupported", checkedAt: null, windows: [], why: UNSUPPORTED_WHY }];
        if (!row.ok)
            return [{ ...base, status: "unknown", checkedAt: report.fetchedAt, windows: [], why: row.error ?? NOT_CHECKED_WHY }];
        const windows = rowWindows(row);
        const plan = row.plan ? { plan: row.plan } : {};
        return [windows.length
                ? { ...base, ...plan, status: "ok", checkedAt: report.fetchedAt, windows }
                : { ...base, ...plan, status: "unknown", checkedAt: report.fetchedAt, windows: [], why: NO_WINDOWS_WHY }];
    });
}
