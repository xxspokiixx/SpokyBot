import { loginMatchesHost, loginSite, loginUsableBy, normalizeLoginHost } from "../shared/logins.js";
import { parseTotpKey } from "./totp.js";
export function loginFields(fields) {
    const byId = (id) => fields.find((field) => field.id === id && field.value);
    const username = byId("username")
        ?? fields.find((field) => (field.fieldType === "Text" || field.fieldType === "Email") && /user|e-?mail|login/iu.test(field.title) && field.value);
    const password = byId("password") ?? fields.find((field) => field.fieldType === "Concealed" && /pass/iu.test(field.title) && field.value);
    const totp = fields.find((field) => field.fieldType === "Totp" && field.value);
    return { username: username?.value ?? "", password: password?.value ?? "", totp: totp?.value ?? null };
}
/** The SDK did not load: a fault in this installation, never in the person's token, which was not even checked. */
export class OnePasswordUnavailableError extends Error {
    constructor() {
        super("1Password could not start on this server, so your token was not checked: this installation is missing its 1Password part. Update SpokyBot, then connect again.");
        this.name = "OnePasswordUnavailableError";
    }
}
/** Why the SDK did not load goes to the server log for whoever reads it; the person gets the plain words. */
export function onePasswordUnavailable(error, log = (line) => console.warn(line)) {
    log(`1Password: the SDK did not load: ${(error instanceof Error ? error.message : String(error)).split("\n", 1)[0]}`);
    return new OnePasswordUnavailableError();
}
export async function sdkOnePasswordClient(sdk, token, version) {
    const client = await sdk.createClient({ auth: token, integrationName: "SpokyBot", integrationVersion: version });
    return {
        vaults: async () => (await client.vaults.list()).map((vault) => ({ id: vault.id, title: vault.title })),
        loginItems: async (vaultId) => (await client.items.list(vaultId))
            .filter((item) => item.category === "Login" && (item.websites?.length ?? 0) > 0)
            .map((item) => ({ id: item.id, title: item.title, urls: (item.websites ?? []).map((site) => site.url) })),
        fields: async (vaultId, itemIds) => {
            const found = new Map();
            if (!itemIds.length)
                return found;
            const { individualResponses } = await client.items.getAll(vaultId, itemIds);
            for (const response of individualResponses)
                if (response.content)
                    found.set(response.content.id, loginFields(response.content.fields));
            return found;
        },
    };
}
const ID_PREFIX = "1password:";
const MAX_ITEMS = 500;
const FIELDS_BATCH = 50;
const STALE_MS = 10 * 60_000;
export function isOnePasswordLoginId(id) {
    return id.startsWith(ID_PREFIX);
}
function bySite(hosts) {
    const sites = new Map();
    for (const host of hosts) {
        const site = loginSite(host);
        sites.set(site, [...(sites.get(site) ?? []), host]);
    }
    return sites;
}
export const ONE_PASSWORD_MALFORMED = "That is not a whole 1Password service account token. Copy all of it (it starts with ops_ and is very long), or make a new one in 1Password under Developer → Service accounts.";
export const ONE_PASSWORD_REFUSED = "1Password did not accept the token: it may have been revoked, expired, or lost access to its vault. Make a new service account token in 1Password and paste it here.";
/** Words for the person, never the token. A fault of this installation is never blamed on the token. */
export function onePasswordProblem(error) {
    if (error instanceof OnePasswordUnavailableError)
        return error.message;
    const name = error instanceof Error ? error.name : "";
    const text = error instanceof Error ? error.message : String(error);
    if (name === "RateLimitExceededError" || /rate limit/iu.test(text))
        return "1Password is limiting requests right now. Try again in a few minutes.";
    if (/invalid format|deserializ/iu.test(text))
        return ONE_PASSWORD_MALFORMED;
    if (name === "AuthExpiredError" || /invalid|unauthori[sz]ed|authenticat|service account token|forbidden|\b40[13]\b/iu.test(text))
        return ONE_PASSWORD_REFUSED;
    if (/fetch|network|ENOTFOUND|ECONN|timed? ?out|dns/iu.test(text))
        return "Could not reach 1Password. Check the internet connection and try again.";
    return "1Password could not be read. Try again, or connect it again with a new token.";
}
export class OnePasswordLogins {
    token;
    connect;
    grants;
    now;
    client = null;
    entries = [];
    vaults = [];
    items = 0;
    refreshedAt = null;
    error;
    refreshing = null;
    lastUsed = new Map();
    constructor(options) {
        this.token = options.token;
        this.connect = options.connect;
        this.grants = options.grants ?? (() => ({}));
        this.now = options.now ?? Date.now;
    }
    botsFor(vaultId) {
        return this.grants()[vaultId] ?? "all";
    }
    connected() {
        const vaults = this.vaults.map((vault) => ({ ...vault, bots: this.botsFor(vault.id) }));
        return { connected: true, vaults, items: this.items, ...(this.error ? { error: this.error } : {}) };
    }
    status() {
        return this.token() ? this.connected() : { connected: false };
    }
    hasVault(id) {
        return Boolean(this.token()) && this.vaults.some((vault) => vault.id === id);
    }
    async clientFor(token) {
        if (this.client?.token === token)
            return this.client.client;
        const client = await this.connect(token);
        this.client = { token, client };
        return client;
    }
    refresh(token) {
        if (!token && this.refreshing)
            return this.refreshing;
        const run = this.read(token).finally(() => { if (this.refreshing === run)
            this.refreshing = null; });
        if (!token)
            this.refreshing = run;
        return run;
    }
    async read(candidate) {
        const token = candidate ?? this.token();
        if (!token) {
            this.clear();
            return this.status();
        }
        try {
            const client = await this.clientFor(token);
            const vaults = await client.vaults();
            const entries = [];
            const counted = [];
            for (const vault of vaults) {
                let items = 0;
                const logins = (await client.loginItems(vault.id)).slice(0, MAX_ITEMS);
                for (let start = 0; start < logins.length; start += FIELDS_BATCH) {
                    const batch = logins.slice(start, start + FIELDS_BATCH);
                    // The password in this answer is dropped here and read again at fill.
                    const fields = await client.fields(vault.id, batch.map((item) => item.id));
                    for (const item of batch) {
                        const found = fields.get(item.id);
                        if (!found?.password)
                            continue;
                        items++;
                        for (const [site, hosts] of bySite(new Set(item.urls.flatMap((url) => normalizeLoginHost(url) ?? [])))) {
                            entries.push({ id: `${ID_PREFIX}${vault.id}:${item.id}:${site}`, vaultId: vault.id, itemId: item.id, site, hosts, exactHost: false,
                                username: found.username, hasTotp: Boolean(found.totp && parseTotpKey(found.totp)) });
                        }
                    }
                }
                counted.push({ id: vault.id, title: vault.title, items });
            }
            this.entries = entries.sort((a, b) => a.site.localeCompare(b.site) || a.username.localeCompare(b.username));
            this.vaults = counted.sort((a, b) => a.title.localeCompare(b.title));
            this.items = counted.reduce((sum, vault) => sum + vault.items, 0);
            this.refreshedAt = this.now();
            this.error = undefined;
            return this.connected();
        }
        catch (error) {
            this.client = null;
            if (candidate)
                throw new Error(onePasswordProblem(error));
            this.error = onePasswordProblem(error);
            return this.status();
        }
    }
    clear() {
        this.client = null;
        this.entries = [];
        this.vaults = [];
        this.items = 0;
        this.refreshedAt = null;
        this.error = undefined;
        this.lastUsed.clear();
    }
    async fresh() {
        if (!this.token())
            return;
        if (this.refreshedAt === null || this.now() - this.refreshedAt > STALE_MS)
            await this.refresh();
    }
    list() {
        if (!this.token())
            return [];
        return this.entries.map((entry) => ({
            id: entry.id, site: entry.site, hosts: [...entry.hosts], exactHost: false, username: entry.username, hasTotp: entry.hasTotp, source: "1password",
            bots: this.botsFor(entry.vaultId), createdAt: 0, ...(this.lastUsed.has(entry.itemId) ? { lastUsedAt: this.lastUsed.get(entry.itemId) } : {}),
        }));
    }
    /** A vault narrowed to other bots is invisible to this one. */
    usable(botId) {
        return this.token() ? this.entries.filter((entry) => loginUsableBy({ bots: this.botsFor(entry.vaultId) }, botId)) : [];
    }
    sitesFor(botId) {
        return this.usable(botId).map((entry) => ({ site: entry.site, hosts: [...entry.hosts], exactHost: false, username: entry.username }));
    }
    candidates(pageHost, botId) {
        const token = this.token();
        if (!token)
            return [];
        return this.usable(botId).filter((entry) => loginMatchesHost(entry, pageHost)).map((entry) => ({
            id: entry.id, site: entry.site, hosts: [...entry.hosts], exactHost: false, username: entry.username, source: "1password",
            secrets: async () => {
                let found;
                try {
                    const client = await this.clientFor(token);
                    found = (await client.fields(entry.vaultId, [entry.itemId])).get(entry.itemId);
                }
                catch (error) {
                    this.client = null;
                    throw new Error(onePasswordProblem(error));
                }
                if (!found?.password)
                    throw new Error("This login is no longer in 1Password, or has no password there.");
                return { password: found.password, totp: found.totp ? parseTotpKey(found.totp) : null };
            },
        }));
    }
    markUsed(id) {
        const entry = this.entries.find((candidate) => candidate.id === id);
        if (entry)
            this.lastUsed.set(entry.itemId, this.now());
    }
}
