const MARKETPLACE_URL = "https://raw.githubusercontent.com/cursor/plugins/main/.cursor-plugin/marketplace.json";
const CACHE_MS = 6 * 60 * 60_000;
let cached = null;
export async function cursorMarketplacePlugins(fetcher = fetch, now = Date.now()) {
    if (cached && cached.expiresAt > now)
        return cached.plugins;
    const response = await fetcher(MARKETPLACE_URL, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
        throw new Error(`Cursor plugin catalog returned HTTP ${response.status}`);
    const body = await response.json();
    if (!record(body) || !Array.isArray(body.plugins))
        throw new Error("Cursor plugin catalog has an invalid format");
    const plugins = body.plugins.flatMap((value) => {
        if (!record(value) || typeof value.name !== "string" || typeof value.source !== "string" || typeof value.description !== "string")
            return [];
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.name))
            return [];
        if (!/^third_party\/[a-z0-9][a-z0-9-]{0,63}$/.test(value.source))
            return [];
        if (record(value.minClientVersions) && value.minClientVersions.cursor === "never")
            return [];
        return [{
                name: value.name,
                source: value.source,
                description: value.description.slice(0, 2_000),
                repositoryUrl: `https://github.com/cursor/plugins/tree/main/${value.source}`,
                marketplaceUrl: `https://cursor.com/marketplace/${value.name}`,
            }];
    });
    if (!plugins.some((plugin) => plugin.name === "slack")) {
        plugins.push({
            name: "slack",
            source: "slackapi/slack-skills-plugin",
            description: "Slack AI tools for users and developers: interact with your workspace via Slack MCP and use Slack developer skills.",
            repositoryUrl: "https://github.com/slackapi/slack-skills-plugin",
            marketplaceUrl: "https://cursor.com/marketplace/slack",
        });
    }
    cached = { expiresAt: now + CACHE_MS, plugins };
    return plugins;
}
export function resetCursorMarketplaceCacheForTests() {
    cached = null;
}
function record(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
