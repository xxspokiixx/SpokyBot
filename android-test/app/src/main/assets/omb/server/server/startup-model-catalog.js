import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "./atomic.js";
import { DATA_DIR } from "./config.js";
const SAFE_INSTANCE_ID = /^[\w.-]+$/;
export function startupModelCachePath(instanceId) {
    if (!SAFE_INSTANCE_ID.test(instanceId))
        return null;
    return join(DATA_DIR, "providers", "engine-models", `${instanceId}.json`);
}
export function laterStartup() {
    try {
        const parsed = JSON.parse(readFileSync(join(DATA_DIR, "bots.json"), "utf8"));
        return Array.isArray(parsed) && parsed.length > 0;
    }
    catch {
        return false;
    }
}
function variantList(value) {
    if (!Array.isArray(value))
        return undefined;
    const variants = value.flatMap((entry) => {
        if (!entry || typeof entry !== "object")
            return [];
        const variant = entry;
        return typeof variant.id === "string" && typeof variant.label === "string"
            ? [{ id: variant.id, label: variant.label }]
            : [];
    });
    return variants.length ? variants : undefined;
}
function catalogFrom(value) {
    if (!value || typeof value !== "object")
        return null;
    const raw = value;
    if (typeof raw.default !== "string" || !Array.isArray(raw.options) || raw.options.length === 0)
        return null;
    const options = [];
    for (const entry of raw.options) {
        if (!entry || typeof entry !== "object")
            return null;
        const option = entry;
        if (typeof option.id !== "string" || typeof option.label !== "string")
            return null;
        const variants = variantList(option.variants);
        options.push({
            id: option.id,
            label: option.label,
            ...(option.custom === true ? { custom: true } : {}),
            ...(option.loaded === true ? { loaded: true } : {}),
            ...(typeof option.provider === "string" ? { provider: option.provider } : {}),
            ...(typeof option.contextWindow === "number" && Number.isFinite(option.contextWindow)
                ? { contextWindow: option.contextWindow }
                : {}),
            ...(variants ? { variants } : {}),
        });
    }
    return { default: raw.default, options };
}
export function readStartupModelCache(instanceId) {
    const path = startupModelCachePath(instanceId);
    if (!path)
        return null;
    try {
        return catalogFrom(JSON.parse(readFileSync(path, "utf8")));
    }
    catch {
        return null;
    }
}
export function writeStartupModelCache(instanceId, catalog) {
    if (!catalog.options.length)
        return;
    const path = startupModelCachePath(instanceId);
    if (!path)
        return;
    const stored = catalogFrom(catalog);
    if (!stored)
        return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileAtomic(path, JSON.stringify(stored), { durable: false });
}
export function openStartupModelCatalog(input) {
    const cached = readStartupModelCache(input.instanceId);
    if (cached)
        input.use(cached);
    const persist = () => {
        try {
            writeStartupModelCache(input.instanceId, input.current());
        }
        catch {
        }
    };
    if (!laterStartup()) {
        return input.refresh().then(() => {
            persist();
            return null;
        });
    }
    return { pending: input.refresh().then(persist, () => undefined) };
}
