// Which config.json MCP servers each bot's turns start: every bot's and the bot's own, minus any that does not start.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic.js";
import { customMcpServers } from "../config.js";
import { addBotMcpServer, claimBotMcpServers, keepForBot, withoutBotMcpServers } from "../mcp-bot-servers.js";
import { createMcpHealth, nameList, toolLabel } from "../mcp-health.js";
import { probeMcpServer } from "../mcp-probe.js";
import { isRemoteMcpServer, parseStoredMcpServer } from "../mcp-registry.js";
import { canUseMcpServer } from "../../shared/tool-scope.js";
const CLAIMED_FILE = (dataDir) => join(dataDir, "mcp-bot-servers.json");
/** What the person hears once when servers in one bot's folder became that bot's own. */
export function claimedNotice(botName, names) {
    const tools = names.toSorted().map(toolLabel);
    return tools.length === 1
        ? `The ${tools[0]} tool only works for ${botName}, so it's off for your other bots.`
        : `The ${nameList(tools)} tools only work for ${botName}, so they're off for your other bots.`;
}
/** The enabled command servers this computer starts, by name, with the bot each is for. */
export function enabledCommandServers(cfg) {
    const out = {};
    for (const [name, raw] of Object.entries(cfg.mcpServers ?? {})) {
        const parsed = parseStoredMcpServer(name, raw);
        if (!parsed.ok || isRemoteMcpServer(parsed.server) || !parsed.server.enabled || parsed.server.runsOn)
            continue;
        const { command, args, env, bot } = parsed.server;
        out[name] = { command, args, env, ...(bot ? { bot } : {}) };
    }
    return out;
}
export function createMcpServersHost(deps) {
    const configured = (bot) => deps.policy(customMcpServers(deps.cfg(), bot.mcpServers, bot.id));
    /** None on an AI that starts no servers, and only those its tool selection reaches. */
    const started = (bot) => (deps.startsServers(bot.id) ? Object.keys(configured(bot)).filter((name) => canUseMcpServer(bot.toolScope, name)) : []);
    const asBot = (botId) => {
        const own = join(deps.dataDir, "workspaces", botId);
        return { id: botId, cwd: existsSync(own) ? own : deps.dataDir };
    };
    const start = deps.start ?? (async (_name, server, botId) => {
        const result = await probeMcpServer({ ...server, enabled: true }, undefined, undefined, { asBot: asBot(botId) });
        return result.ok ? { ok: true } : { ok: false, error: result.error };
    });
    const health = createMcpHealth({
        file: join(deps.dataDir, "mcp-health.json"),
        servers: () => enabledCommandServers(deps.cfg()),
        users: (name) => deps.bots().filter((bot) => started(bot).includes(name)),
        start,
        tell: deps.tell,
    });
    return {
        health,
        /** How Test starts a command server: as the turns of its bot, or of any bot. */
        probeAs: (server) => (server.bot ? asBot(server.bot) : {}),
        mounted: (bot) => health.usable(bot.id, configured(bot)),
        prepare: (bot) => health.prepare(bot.id, started(bot)),
        off: (bot) => health.off(bot.id, started(bot)),
        listing: (server) => {
            const offFor = health.offFor(server.name);
            return offFor.length ? { ...server, offFor } : server;
        },
        botAdd: (current, body, botId) => addBotMcpServer(current, body, botId, deps.dataDir, deps.boxed()),
        botKeep: (server, botId) => keepForBot(server, botId, deps.dataDir, deps.boxed()),
        botDeleted(botId) {
            const next = withoutBotMcpServers(deps.cfg().mcpServers, botId);
            if (next)
                deps.persist(next);
        },
        /** At start: the first time bots run boxed here, servers in one existing bot's folders become its own (said once);
         * then every server is checked. A server added after that stays as it was added. */
        boot() {
            if (deps.boxed() && !existsSync(CLAIMED_FILE(deps.dataDir))) {
                const bots = deps.bots();
                const claimed = claimBotMcpServers(deps.cfg().mcpServers, deps.dataDir, (botId) => bots.some((bot) => bot.id === botId));
                if (claimed)
                    deps.persist(claimed.next);
                writeFileAtomic(CLAIMED_FILE(deps.dataDir), JSON.stringify({ claimedAt: Date.now() }), { mode: 0o600 });
                for (const [botId, names] of Object.entries(claimed?.claimed ?? {})) {
                    const bot = bots.find((candidate) => candidate.id === botId);
                    if (bot && bots.length > 1)
                        deps.tell(claimedNotice(bot.name, names), bot);
                }
            }
            health.checkAll();
        },
    };
}
