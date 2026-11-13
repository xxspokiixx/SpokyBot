// Company-wide or per-person connections on a Team Cloud. Every app (a Composio toolkit) and MCP server has a scope:
// `team`, the default, is one connection an admin makes and every turn uses; `person` is one connection per member, used
// only in that member's own turns in their private chat.
//   - team-connection-scopes.json: which apps and servers are `person` (no secret; backups carry it);
//   - people-connections/: each member's own installation on the connected-apps service (their own Composio user), their
//     own MCP keys and their own MCP sign-ins.
// Security: 0600 files in a 0700 folder that no backup carries and no bot box binds; a member's key and sign-in are pinned
// to the server's address, so an admin re-pointing a server never sends them on.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ensureManagedComposioCredentials, managedComposioAccess } from "../electron/managed-composio.mjs";
import { writeFileAtomic } from "./atomic.js";
import { McpOAuthManager } from "./mcp-oauth.js";
export const SCOPES_FILE = "team-connection-scopes.json";
export const PEOPLE_CONNECTIONS_DIR = "people-connections";
/** Composio's toolkit slugs; an MCP server's name as mcp-registry.ts allows it. */
export const APP_SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const MCP_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const PERSON = /^p_[\w-]{22}$/;
const TOKEN = /^[0-9a-f]{64}$/;
const scopesSchema = z.object({
    v: z.literal(1),
    apps: z.record(z.string(), z.literal("person")).default({}),
    mcp: z.record(z.string(), z.literal("person")).default({}),
});
/** Which apps and MCP servers each person connects for themselves; everything else is the team's. */
export class ConnectionScopes {
    data;
    file;
    constructor(file) {
        this.file = file;
        let parsed = null;
        try {
            parsed = scopesSchema.parse(JSON.parse(readFileSync(file, "utf8")));
        }
        catch {
            parsed = null;
        }
        this.data = parsed ?? { v: 1, apps: {}, mcp: {} };
    }
    /** The `person` apps (slugs) and servers (names), sorted. */
    person(kind) {
        return Object.keys(kind === "app" ? this.data.apps : this.data.mcp).sort();
    }
    scope(kind, id) {
        return Object.hasOwn(kind === "app" ? this.data.apps : this.data.mcp, id) ? "person" : "team";
    }
    set(kind, id, scope) {
        const next = { v: 1, apps: { ...this.data.apps }, mcp: { ...this.data.mcp } };
        const map = kind === "app" ? next.apps : next.mcp;
        if (scope === "person")
            map[id] = "person";
        else
            delete map[id];
        writeFileAtomic(this.file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
        this.data = next;
    }
}
/** The `person` app a Composio tool belongs to (GMAIL_SEND_EMAIL → gmail), the longest matching slug; null if none. */
export function personAppOf(tool, personApps) {
    let match = null;
    for (const slug of personApps) {
        if (tool.toUpperCase().startsWith(`${slug.toUpperCase()}_`) && (match === null || slug.length > match.length))
            match = slug;
    }
    return match;
}
/** An app's name from its slug, as people read it: "google_search_console" → "Google Search Console". */
export const appLabel = (slug) => slug.split(/[-_]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") || slug;
const appsSchema = z.object({
    v: z.literal(1),
    brokerUrl: z.string(),
    people: z.record(z.string(), z.object({ email: z.string(), installationId: z.string().min(1), token: z.string().regex(TOKEN) })).default({}),
});
const keysSchema = z.object({
    v: z.literal(1),
    people: z.record(z.string(), z.object({
        email: z.string(),
        servers: z.record(z.string(), z.object({ url: z.string(), header: z.string(), value: z.string() })).default({}),
    })).default({}),
});
/** Each member's own connections: never read by a route that answers with them, never copied into a turn but theirs. */
export class PeopleConnections {
    dir;
    managers = new Map();
    registering = new Map();
    options;
    constructor(options) {
        this.options = options;
        this.dir = join(options.dataDir, PEOPLE_CONNECTIONS_DIR);
    }
    ensureDir() {
        mkdirSync(join(this.dir, "mcp-oauth"), { recursive: true, mode: 0o700 });
        try {
            chmodSync(this.dir, 0o700);
        }
        catch { }
    }
    read(name, schema, empty) {
        try {
            return schema.parse(JSON.parse(readFileSync(join(this.dir, name), "utf8")));
        }
        catch {
            return empty;
        }
    }
    write(name, value) {
        this.ensureDir();
        writeFileAtomic(join(this.dir, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    }
    apps() {
        const url = this.options.brokerUrl();
        const file = this.read("apps.json", appsSchema, { v: 1, brokerUrl: url ?? "", people: {} });
        // A token goes only to the service that issued it.
        return url && file.brokerUrl === url ? file : { v: 1, brokerUrl: url ?? "", people: {} };
    }
    keys() {
        return this.read("mcp-keys.json", keysSchema, { v: 1, people: {} });
    }
    /** The member's own installation, when they have made one. */
    appsAccess(person) {
        const file = this.apps(), record = file.people[person];
        return record ? managedComposioAccess(file.brokerUrl, { composioBrokerToken: record.token }) : null;
    }
    /** The member's own installation, made now if they have none (the first time they connect an app). */
    ensureAppsAccess(person, email) {
        if (!PERSON.test(person))
            return Promise.resolve(null);
        const held = this.appsAccess(person);
        if (held)
            return Promise.resolve(held);
        const brokerUrl = this.options.brokerUrl();
        if (!brokerUrl)
            return Promise.resolve(null);
        const pending = this.registering.get(person);
        if (pending)
            return pending;
        const made = (async () => {
            const credentials = {};
            await ensureManagedComposioCredentials({
                brokerUrl, credentials, fetchImpl: this.options.fetchImpl,
                saveCredentials: (next) => {
                    if (!next.composioBrokerToken || !next.composioInstallationId)
                        return;
                    const file = this.apps();
                    file.people[person] = { email, installationId: next.composioInstallationId, token: next.composioBrokerToken };
                    this.write("apps.json", { ...file, brokerUrl });
                    this.remember(person, email);
                },
            });
            return this.appsAccess(person);
        })().finally(() => this.registering.delete(person));
        this.registering.set(person, made);
        return made;
    }
    /** Everyone with an installation, with their address (for "who has connected"). */
    appsPeople() {
        const file = this.apps();
        return Object.entries(file.people).flatMap(([person, record]) => {
            const access = managedComposioAccess(file.brokerUrl, { composioBrokerToken: record.token });
            return access ? [{ person, email: record.email, access }] : [];
        });
    }
    key(person, name, url) {
        const held = this.keys().people[person]?.servers[name];
        return held && held.url === url ? held : null;
    }
    putKey(person, email, name, key) {
        if (!PERSON.test(person))
            throw new Error("invalid person");
        const file = this.keys();
        const own = file.people[person] ?? { email, servers: {} };
        file.people[person] = { email, servers: { ...own.servers, [name]: key } };
        this.write("mcp-keys.json", file);
        this.remember(person, email);
    }
    deleteKey(person, name) {
        const file = this.keys();
        if (!file.people[person]?.servers[name])
            return;
        delete file.people[person].servers[name];
        this.write("mcp-keys.json", file);
    }
    /** Who added their own key to a server at this address. */
    keyPeople(name, url) {
        return Object.entries(this.keys().people).flatMap(([person, record]) => record.servers[name]?.url === url ? [{ person, email: record.email }] : []);
    }
    /** The member's own MCP sign-ins: a manager of their own, so flows and tokens never meet another person's. */
    oauth(person) {
        if (!PERSON.test(person))
            throw new Error("invalid person");
        let manager = this.managers.get(person);
        if (!manager) {
            this.ensureDir();
            manager = new McpOAuthManager({
                file: join(this.dir, "mcp-oauth", `${person}.json`), clients: this.options.clients, isOwnerLive: this.options.isOwnerLive,
                ...(this.options.onSettled ? { onSettled: this.options.onSettled } : {}),
            });
            this.managers.set(person, manager);
        }
        return manager;
    }
    /** The member's own sign-in and key for a personal server, to test it as them. */
    connection(person, name, url) {
        const key = this.key(person, name, url);
        return { oauth: this.oauth(person), ...(key ? { key } : {}) };
    }
    /** Managers with a flow that may be waiting for its callback (made in this process). */
    liveManagers() {
        return [...this.managers.values()];
    }
    /** Everyone who signed in to a server at this address. */
    signedInPeople(name, url) {
        const folder = join(this.dir, "mcp-oauth");
        if (!existsSync(folder))
            return [];
        return readdirSync(folder).flatMap((file) => {
            const person = file.replace(/\.json$/, "");
            if (!PERSON.test(person) || !file.endsWith(".json"))
                return [];
            return this.oauth(person).authState(name, url) === "signed-in" ? [{ person, email: this.emailOf(person) ?? "" }] : [];
        });
    }
    /** The address a person used here (who connected is shown by address; it is not a secret). */
    emailOf(person) {
        return this.read("people.json", z.record(z.string(), z.string()), {})[person] ?? null;
    }
    remember(person, email) {
        if (!PERSON.test(person) || !email)
            return;
        const file = this.read("people.json", z.record(z.string(), z.string()), {});
        if (file[person] === email)
            return;
        this.write("people.json", { ...file, [person]: email });
    }
    /** An MCP server was removed: every person's key and sign-in for it go too. */
    forgetServer(name) {
        const file = this.keys();
        let changed = false;
        for (const record of Object.values(file.people))
            if (record.servers[name]) {
                delete record.servers[name];
                changed = true;
            }
        if (changed)
            this.write("mcp-keys.json", file);
        const folder = join(this.dir, "mcp-oauth");
        if (!existsSync(folder))
            return;
        for (const entry of readdirSync(folder)) {
            const person = entry.replace(/\.json$/, "");
            if (PERSON.test(person))
                this.oauth(person).forget(name);
        }
    }
    /** Test seam and deletion: everything a person connected here. */
    forgetPerson(person) {
        const apps = this.apps();
        if (apps.people[person]) {
            delete apps.people[person];
            this.write("apps.json", apps);
        }
        const keys = this.keys();
        if (keys.people[person]) {
            delete keys.people[person];
            this.write("mcp-keys.json", keys);
        }
        this.managers.get(person)?.dispose();
        this.managers.delete(person);
        rmSync(join(this.dir, "mcp-oauth", `${person}.json`), { force: true });
    }
}
/** A member's key as the header the server expects: the header an admin's key used, else Authorization, as a bearer. */
export function personKeyHeader(teamHeaders, value) {
    const header = teamHeaders[0] ?? "Authorization";
    const trimmed = value.trim();
    return { header, value: header.toLowerCase() === "authorization" && !/^\w+\s/.test(trimmed) ? `Bearer ${trimmed}` : trimmed };
}
