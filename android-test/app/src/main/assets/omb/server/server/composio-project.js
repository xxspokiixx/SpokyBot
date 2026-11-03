// A person's own Composio project, reached with their ak_ key. A Tool Router Session uses one of the project's own auth
// configs (a bring-your-own OAuth app such as Xero or Buffer, or an API-key toolkit) only when it is created with that
// config's id under `auth_configs`, keyed by toolkit, and the config must be enabled for Tool Router:
// https://docs.composio.dev/docs/configuring-sessions
// https://docs.composio.dev/kb/guide/mcp-tool-router-sessions
// https://docs.composio.dev/reference/api-reference/auth-configs/getAuthConfigs
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { AUTH_CONFIG_ID } from "../shared/connector-availability.js";
import { writeFileAtomic } from "./atomic.js";
import { DATA_DIR } from "./config.js";
export const DEFAULT_BACKEND_ORIGIN = "https://backend.composio.dev";
export function apiBase() {
    return (process.env.OMB_COMPOSIO_API ?? `${DEFAULT_BACKEND_ORIGIN}/api/v3.1`).replace(/\/$/, "");
}
export function projectHeaders(apiKey, json = false) {
    const headers = new Headers({ "x-api-key": apiKey });
    if (json)
        headers.set("content-type", "application/json");
    return headers;
}
export async function responseError(res, fallback) {
    const raw = await res.text().catch(() => "");
    try {
        const body = JSON.parse(raw);
        return String(body?.message ?? body?.error?.message ?? body?.error ?? fallback);
    }
    catch {
        return raw.trim().slice(0, 300) || fallback;
    }
}
export function inputError(message, status = 400) {
    return Object.assign(new Error(message), { status });
}
/** Composio's slug is `twitter`; saved cards and model calls may still say `x`. */
export function canonicalToolkitSlug(slug) {
    const normalized = slug.trim().toLowerCase();
    return normalized === "x" ? "twitter" : normalized;
}
const authConfigItemSchema = z.object({
    id: z.string().optional(),
    status: z.string().nullable().optional(),
    is_composio_managed: z.boolean().optional(),
    is_enabled_for_tool_router: z.boolean().nullable().optional(),
    last_updated_at: z.string().nullable().optional(),
    toolkit: z.object({ slug: z.string().optional() }).optional(),
});
const authConfigsPageSchema = z.object({
    items: z.array(authConfigItemSchema).optional(),
    next_cursor: z.string().nullable().optional(),
});
const MAX_AUTH_CONFIG_PAGES = 20;
const LISTING_TTL_MS = 60_000;
const LISTING_RETRY_MS = 15_000;
function usableConfig(item) {
    return item.is_composio_managed !== true && (!item.status || /^enabled$/i.test(item.status));
}
async function readListing(apiKey) {
    const found = new Map();
    const usable = new Map();
    const offForToolRouter = new Set();
    let cursor;
    for (let page = 0; page < MAX_AUTH_CONFIG_PAGES; page++) {
        const params = new URLSearchParams({ is_composio_managed: "false", limit: "100" });
        if (cursor)
            params.set("cursor", cursor);
        const res = await fetch(`${apiBase()}/auth_configs?${params}`, {
            headers: projectHeaders(apiKey),
            signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok)
            throw new Error(await responseError(res, `HTTP ${res.status}`));
        const body = authConfigsPageSchema.parse(await res.json());
        for (const item of body.items ?? []) {
            const slug = item.toolkit?.slug ? canonicalToolkitSlug(item.toolkit.slug) : "";
            if (!slug || !item.id || !usableConfig(item))
                continue;
            if (item.is_enabled_for_tool_router === false) {
                offForToolRouter.add(slug);
                continue;
            }
            usable.set(item.id, slug);
            found.set(slug, [...found.get(slug) ?? [], { id: item.id, updated: item.last_updated_at ?? "" }]);
        }
        const next = body.next_cursor ?? undefined;
        if (!next || next === cursor)
            break;
        cursor = next;
    }
    const byToolkit = new Map();
    for (const [slug, configs] of found) {
        byToolkit.set(slug, configs.sort((a, b) => b.updated.localeCompare(a.updated)).map(({ id }) => id));
        offForToolRouter.delete(slug);
    }
    return { byToolkit, usable, offForToolRouter };
}
const listings = new Map();
const listingReads = new Map();
const loggedChoices = new Map();
/** Separates per-project state without keeping another plaintext copy of the key. */
function projectFingerprint(apiKey) {
    return createHash("sha256").update("composio-project\0").update(apiKey.trim()).digest("hex");
}
function refreshListing(apiKey, project) {
    const pending = listingReads.get(project);
    if (pending)
        return pending;
    const read = readListing(apiKey).then((listing) => ({ listing, expiresAt: Date.now() + LISTING_TTL_MS }), (error) => {
        const readError = error instanceof Error ? error.message : String(error);
        console.warn(`[composio] could not read the project's auth configs (${readError}); Sessions keep the last list`);
        const previous = listings.get(project)?.listing;
        return {
            listing: previous ?? { byToolkit: new Map(), usable: new Map(), offForToolRouter: new Set() },
            expiresAt: Date.now() + LISTING_RETRY_MS,
            readError,
        };
    }).then((entry) => {
        listings.set(project, entry);
        return entry;
    }).finally(() => listingReads.delete(project));
    listingReads.set(project, read);
    return read;
}
/** The auth configs a Session for this project should name. Never throws: a failed read keeps the last list (or none). */
export async function projectAuthConfigs(apiKey, options = {}) {
    const project = projectFingerprint(apiKey);
    const cached = listings.get(project);
    const entry = !options.fresh && cached && Date.now() < cached.expiresAt ? cached : await refreshListing(apiKey, project);
    const picked = authConfigPicks(project);
    const configs = {};
    for (const [slug, ids] of entry.listing.byToolkit) {
        const pick = picked[slug];
        const chosen = pick && entry.listing.usable.get(pick) === slug ? pick : ids[0];
        configs[slug] = chosen;
        const logKey = `${project}:${slug}`;
        if (ids.length > 1 && chosen !== pick && loggedChoices.get(logKey) !== chosen) {
            loggedChoices.set(logKey, chosen);
            console.info(`[composio] ${ids.length} enabled auth configs for ${slug}; using the most recently updated, ${chosen}`);
        }
    }
    return {
        configs: Object.fromEntries(Object.entries(configs).sort(([a], [b]) => a.localeCompare(b))),
        offForToolRouter: [...entry.listing.offForToolRouter].sort(),
        ...(entry.readError ? { readError: entry.readError } : {}),
    };
}
/** The next lookup reads Composio again, as when a call just failed for want of an auth config; a project's last list
 * stays the fallback. */
export function forgetProjectAuthConfigs(apiKey) {
    if (apiKey === undefined)
        listings.clear();
    const entry = apiKey === undefined ? undefined : listings.get(projectFingerprint(apiKey));
    if (entry)
        entry.expiresAt = 0;
}
const picksFileSchema = z.object({
    version: z.literal(1),
    projects: z.record(z.string(), z.record(z.string(), z.string().regex(AUTH_CONFIG_ID))),
});
let picks;
const picksFile = () => join(DATA_DIR, "composio-auth-configs.json");
function authConfigPicks(project) {
    if (!picks) {
        try {
            picks = picksFileSchema.parse(JSON.parse(readFileSync(picksFile(), "utf8"))).projects;
        }
        catch {
            picks = {};
        }
    }
    return picks[project] ?? {};
}
export function noAuthConfigReason(toolkit) {
    return `${toolkit} has no Composio-managed sign-in. In your Composio project, create an auth config for "${toolkit}" `
        + "(Auth Configs → Create) with your own app credentials, then click Connect again.";
}
export function offForToolRouterReason(toolkit) {
    return `Your ${toolkit} auth config is not enabled for Tool Router. Enable it for Tool Router in your Composio project, then connect ${toolkit} again.`;
}
export function refusedAuthConfigReason(toolkit, said) {
    return `Composio would not use your ${toolkit} auth config. Check it is enabled, and enabled for Tool Router, in your Composio project. Composio said: ${said}`;
}
/** A bot's explicit `auth_config_id`, checked against the project before any Session names it. */
async function checkAuthConfigPick(apiKey, toolkit, id) {
    const res = await fetch(`${apiBase()}/auth_configs/${encodeURIComponent(id)}`, {
        headers: projectHeaders(apiKey),
        signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 400 || res.status === 404) {
        throw inputError(`Composio has no auth config ${id} in the project SpokyBot uses. Copy the id from Auth Configs in that Composio project.`);
    }
    if (!res.ok)
        throw new Error(await responseError(res, `Composio auth config: HTTP ${res.status}`));
    const item = authConfigItemSchema.parse(await res.json());
    const owner = item.toolkit?.slug ? canonicalToolkitSlug(item.toolkit.slug) : toolkit;
    if (owner !== toolkit)
        throw inputError(`Auth config ${id} is for ${owner}, not ${toolkit}.`);
    if (item.is_composio_managed === true) {
        throw inputError(`Auth config ${id} is Composio's own sign-in for ${toolkit}, which SpokyBot already uses, so no auth_config_id is needed.`);
    }
    if (!usableConfig(item))
        throw inputError(`Auth config ${id} for ${toolkit} is disabled. Enable it in your Composio project, then connect again.`);
    if (item.is_enabled_for_tool_router === false)
        throw inputError(offForToolRouterReason(toolkit));
}
/** Checks a bot's pick and keeps it for this project's later Sessions; it wins over the newest config while it stays usable. */
export async function keepAuthConfigPick(apiKey, toolkit, id) {
    await checkAuthConfigPick(apiKey, toolkit, id);
    const project = projectFingerprint(apiKey);
    authConfigPicks(project);
    picks = { ...picks, [project]: { ...picks?.[project], [toolkit]: id } };
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    writeFileAtomic(picksFile(), `${JSON.stringify({ version: 1, projects: picks }, null, 2)}\n`, { mode: 0o600 });
    forgetProjectAuthConfigs(apiKey);
}
