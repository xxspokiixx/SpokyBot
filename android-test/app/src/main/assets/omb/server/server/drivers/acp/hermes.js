// Hermes Agent (Nous Research's `hermes acp`), custom-only. ACP ignores `hermes -m` (cmd_acp does not
// forward it), and OPENAI_API_KEY makes provider:auto resolve to OpenRouter without its key ("HTTP 401:
// Missing Authentication header"), so injects write providers.<host> and set_model `custom:<host>:<model>`.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { harnessHome } from "../../env-path.js";
import { resolveCli } from "../../procs.js";
import { decodeInjectId, hostApiKey, INJECT_SEP, localHost, mergeLocalInject } from "../local-inject.js";
import { createAcpDriver } from "./core.js";
const EMPTY = { default: "", options: [] };
export const HERMES_OPENMAUS_SCREENSHOT_COMPAT = "HERMES_OPENMAUS_SCREENSHOT_COMPAT";
export const HERMES_OPENMAUS_SCREENSHOT_COMPAT_MODEL = "HERMES_OPENMAUS_SCREENSHOT_COMPAT_MODEL";
export function bindHermesScreenshotCompat(env, modelId) {
    delete env[HERMES_OPENMAUS_SCREENSHOT_COMPAT];
    delete env[HERMES_OPENMAUS_SCREENSHOT_COMPAT_MODEL];
    const inject = decodeInjectId(modelId);
    if (!inject)
        return;
    env[HERMES_OPENMAUS_SCREENSHOT_COMPAT] = "1";
    env[HERMES_OPENMAUS_SCREENSHOT_COMPAT_MODEL] = inject.model;
}
function quoteYaml(value) {
    if (/^[\w./:+-]+$/.test(value))
        return value;
    return JSON.stringify(value);
}
function upsertHermesProvider(text, hostId, baseUrl, apiKey) {
    const block = [`  ${hostId}:`, `    base_url: ${quoteYaml(baseUrl)}`, `    api_key: ${quoteYaml(apiKey)}`, ""].join("\n");
    if (/^providers:\s*$/m.test(text)) {
        const replaced = replaceHermesHostBlock(text, hostId, block);
        if (replaced !== null)
            return replaced;
        return text.replace(/^providers:\s*$/m, `providers:\n${block.trimEnd()}`);
    }
    const prefix = text && !text.endsWith("\n") ? `${text}\n` : text;
    return `${prefix}\nproviders:\n${block}`;
}
/** Replace `  hostId:` through the next sibling 2-space key or a top-level key. */
function replaceHermesHostBlock(text, hostId, block) {
    const lines = text.split("\n");
    const start = lines.findIndex((line) => line === `  ${hostId}:`);
    if (start < 0)
        return null;
    let end = start + 1;
    while (end < lines.length) {
        const line = lines[end];
        if (/^  \S/.test(line) || /^\S/.test(line))
            break;
        end++;
    }
    while (end > start + 1 && lines[end - 1] === "")
        end--;
    return [...lines.slice(0, start), ...block.replace(/\n$/, "").split("\n"), ...lines.slice(end)].join("\n");
}
export function ensureHermesInjectProvider(modelId, env = process.env) {
    const inject = decodeInjectId(modelId);
    if (!inject)
        return modelId;
    const host = localHost(inject.host);
    if (!host)
        return modelId;
    const dir = env.HERMES_HOME || harnessHome("hermes", env);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "config.yaml");
    let text = "";
    try {
        text = readFileSync(path, "utf8");
    }
    catch {
        text = "";
    }
    const next = upsertHermesProvider(text, inject.host, host.baseUrl, hostApiKey(host, env));
    if (next !== text)
        writeFileSync(path, next);
    return hermesAcpModelId(modelId) ?? modelId;
}
/** ACP session/set_model id; Hermes parse_model_input reads `custom:name:model`. */
export function hermesAcpModelId(modelId) {
    const inject = decodeInjectId(modelId);
    if (inject)
        return `custom:${inject.host}:${inject.model}`;
    // Hermes' own ACP ids are `<provider>:<model>` (`openrouter:qwen/qwen3.8-max`), forwarded untouched.
    const native = typeof modelId === "string" ? modelId.trim() : "";
    if (native && !native.includes(INJECT_SEP) && /^[a-z0-9_-]+:[\w./:-]+$/i.test(native))
        return native;
    return null;
}
/** Not an inject id: no session/set_model and no -m, so Hermes runs the model in its own config.yaml. */
export const HERMES_CONFIG_MODEL_ID = "hermes-default";
function nonEmptyDotenvValue(text, name) {
    const match = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=[ \\t]*([^\\r\\n]*)$`, "m").exec(text);
    if (!match)
        return null;
    const raw = match[1].trim();
    if (!raw || raw.startsWith("#"))
        return null;
    const quote = raw[0];
    if (quote === '"' || quote === "'") {
        const closing = raw.indexOf(quote, 1);
        if (closing < 0)
            return null;
        const trailing = raw.slice(closing + 1).trim();
        if (trailing && !trailing.startsWith("#"))
            return null;
        return raw.slice(1, closing).trim() || null;
    }
    return raw.replace(/[ \t]+#.*$/, "").trim() || null;
}
const HERMES_HOSTED_PROVIDER_KEYS = [
    "OPENROUTER_API_KEY",
    "GLM_API_KEY",
    "ZAI_API_KEY",
    "Z_AI_API_KEY",
];
const HERMES_LOCAL_CONFIG_PROVIDERS = new Set(["custom", "lmstudio", "ollama", "vllm", "llamacpp"]);
function yamlString(value) {
    return typeof value === "string" ? value.trim() : "";
}
/** The forms Hermes' `_normalize_root_model_keys` accepts: a scalar `model`, or a mapping whose id is
 * `default`, `model` or `name` (itself possibly `{ provider, model/default }`). An explicit outer provider
 * wins except `auto`; root-level `provider` is Hermes' legacy fallback. */
function hermesConfigDefault(text) {
    let raw;
    try {
        raw = parseYaml(text);
    }
    catch {
        return null;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return null;
    const config = raw;
    const rootProvider = yamlString(config.provider);
    if (typeof config.model === "string") {
        const model = config.model.trim();
        return model ? { model, provider: rootProvider } : null;
    }
    if (!config.model || typeof config.model !== "object" || Array.isArray(config.model))
        return null;
    const modelConfig = config.model;
    const outerProvider = yamlString(modelConfig.provider) || rootProvider;
    for (const key of ["default", "model", "name"]) {
        const candidate = modelConfig[key];
        const scalar = yamlString(candidate);
        if (scalar)
            return { model: scalar, provider: outerProvider };
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
            continue;
        const nested = candidate;
        const nestedModel = yamlString(nested.model) || yamlString(nested.default);
        if (!nestedModel)
            continue;
        const nestedProvider = yamlString(nested.provider);
        const provider = !outerProvider || outerProvider === "auto" ? nestedProvider || outerProvider : outerProvider;
        return { model: nestedModel, provider };
    }
    return null;
}
/** Whether Hermes has a hosted provider: an OpenRouter or Z.AI key in `~/.hermes/.env`, or Nous Portal
 * OAuth. Read-only: a catalog probe must never rewrite the user's config.yaml. */
export function hermesConfiguredModel(env = process.env) {
    const dir = env.HERMES_HOME || harnessHome("hermes", env);
    let secrets = "";
    try {
        secrets = readFileSync(join(dir, ".env"), "utf8");
    }
    catch { }
    const hasHostedProviderKey = HERMES_HOSTED_PROVIDER_KEYS.some((name) => nonEmptyDotenvValue(secrets, name));
    // `hermes login` / `hermes setup` record the default in config.yaml; the OAuth token lives in Hermes' auth store.
    let configuredDefault = null;
    try {
        configuredDefault = hermesConfigDefault(readFileSync(join(dir, "config.yaml"), "utf8"));
    }
    catch { }
    const configuredProvider = configuredDefault?.provider.toLowerCase() ?? "";
    const configIsLocal = HERMES_LOCAL_CONFIG_PROVIDERS.has(configuredProvider) || configuredProvider.startsWith("custom:");
    if (configuredDefault && configIsLocal)
        return null;
    const configIsHosted = configuredDefault !== null;
    if (!hasHostedProviderKey && !configIsHosted)
        return null;
    const model = configuredDefault?.model ?? "";
    // `custom: true` is load-bearing: a custom-only agent's picker pane lists only options carrying it.
    return {
        id: HERMES_CONFIG_MODEL_ID,
        label: model ? `${model} (Hermes config)` : "Hermes default (config)",
        custom: true,
    };
}
export const HERMES_ACP_MODELS_TIMEOUT_ENV = "HERMES_ACP_MODELS_TIMEOUT_MS";
/** Hermes with several providers answers initialize in about a second but session/new, which carries
 * the models, in ~6-7 s. */
export const HERMES_ACP_MODELS_DEFAULT_TIMEOUT_MS = 15_000;
function hermesAcpModelsTimeoutMs(env) {
    const raw = env[HERMES_ACP_MODELS_TIMEOUT_ENV];
    if (raw === undefined)
        return HERMES_ACP_MODELS_DEFAULT_TIMEOUT_MS;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 2_147_483_647
        ? parsed
        : HERMES_ACP_MODELS_DEFAULT_TIMEOUT_MS;
}
/** Hermes advertises its whole catalog on session/new and has no `hermes models` subcommand. */
export async function fetchHermesAcpModels(cli, env) {
    return await new Promise((resolve) => {
        let child;
        try {
            const resolved = resolveCli(cli, ["acp"], env);
            child = spawn(resolved.command, resolved.args, { stdio: ["pipe", "pipe", "ignore"], env: env, windowsHide: true });
        }
        catch {
            return resolve([]);
        }
        let settled = false;
        let timer;
        let hardKillTimer;
        const done = (out) => {
            if (settled)
                return;
            settled = true;
            if (timer)
                clearTimeout(timer);
            try {
                if (child.kill()) {
                    hardKillTimer = setTimeout(() => {
                        try {
                            child.kill("SIGKILL");
                        }
                        catch { }
                    }, 1_000);
                    hardKillTimer.unref?.();
                }
            }
            catch { }
            resolve(out);
        };
        timer = setTimeout(() => done([]), hermesAcpModelsTimeoutMs(env));
        child.once("error", () => done([]));
        // A child that already exited makes stdin emit EPIPE, and an unhandled stream 'error' crashes the server.
        child.stdin?.on("error", () => done([]));
        child.once("close", () => {
            if (hardKillTimer)
                clearTimeout(hardKillTimer);
            done([]);
        });
        let buf = "";
        let id = 0;
        const send = (method, params) => {
            id += 1;
            try {
                if (!child.stdin?.writable) {
                    done([]);
                    return 0;
                }
                child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (error) => {
                    if (error)
                        done([]);
                });
            }
            catch {
                done([]);
                return 0;
            }
            return id;
        };
        let initId = 0;
        let sessionId = 0;
        child.stdout?.on("data", (chunk) => {
            buf += String(chunk);
            let nl;
            while ((nl = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, nl);
                buf = buf.slice(nl + 1);
                let msg;
                try {
                    msg = JSON.parse(line);
                }
                catch {
                    continue;
                }
                if (msg?.id === initId) {
                    if (!msg.result)
                        return done([]);
                    sessionId = send("session/new", { cwd: env.HOME || env.USERPROFILE || homedir(), mcpServers: [] });
                }
                else if (sessionId && msg?.id === sessionId) {
                    const list = Array.isArray(msg.result?.models?.availableModels)
                        ? msg.result.models.availableModels
                        : [];
                    done(list
                        .filter((m) => typeof m?.modelId === "string" && m.modelId)
                        .map((m) => ({
                        id: m.modelId,
                        label: (typeof m.name === "string" && m.name.trim()) || m.modelId,
                        custom: true,
                    })));
                }
            }
        });
        initId = send("initialize", {
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        });
    });
}
async function resolveModels(env, config) {
    const catalog = await mergeLocalInject(EMPTY, env);
    const configured = hermesConfiguredModel(env);
    const remote = configured ? await fetchHermesAcpModels(config?.cli || "hermes", env) : [];
    const seen = new Set();
    const options = [...(configured ? [configured] : []), ...remote, ...catalog.options].filter((o) => {
        if (seen.has(o.id))
            return false;
        seen.add(o.id);
        return true;
    });
    return { default: options[0]?.id ?? "", options };
}
async function applySetting(request, method, params, what) {
    try {
        await request(method, params);
    }
    catch (e) {
        throw new Error(`Hermes rejected ${what} via ${method}: ${e.message}`);
    }
}
const support = {
    driverKind: "hermesAgent",
    displayName: "Hermes",
    access: "custom",
    models: EMPTY,
    resolveModels: (env, config) => resolveModels(env, config),
    resolveTurnModel: (model, env) => {
        // Never inherit a broad or stale compatibility grant from the parent; bind one concrete model.
        bindHermesScreenshotCompat(env, model);
        if (!model)
            return model;
        ensureHermesInjectProvider(model, env);
        return model;
    },
    defaultCli: "hermes",
    nativeSource: "hermes.acp",
    loginNote: "Hermes CLI is not installed",
    install: {
        command: {
            darwin: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
            linux: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
            win32: "iex (irm https://hermes-agent.nousresearch.com/install.ps1)",
        },
        docsUrl: "https://hermes-agent.nousresearch.com/docs/getting-started/quickstart",
        signInCommand: "hermes setup",
    },
    spawnArgs: () => ["acp"],
    // Hermes keeps the first MCP server it registers under a name for the process's life, so a new bearer needs a fresh process.
    restartOnMcpChange: true,
    resendsReasoningReply: true,
    transformEnv: (env) => {
        // A leftover OPENAI_API_KEY makes Hermes auto-resolve to OpenRouter with no Authorization header.
        delete env.OPENAI_API_KEY;
        delete env.OPENROUTER_API_KEY;
    },
    pickAuthMethod: () => null,
    authFailure: "continue",
    isAuthenticated: () => true,
    async configureSession({ request, sessionId, turn }) {
        // Decode only: ensure* here would read process.env and rewrite the user's real ~/.hermes/config.yaml.
        const native = hermesAcpModelId(turn.model);
        if (!native)
            return;
        await applySetting(request, "session/set_model", { sessionId, modelId: native }, `model "${native}"`);
    },
    buildPromptText: (turn) => (turn.system ? `${turn.system}\n\n${turn.text}` : turn.text),
};
export const HermesAgentDriver = createAcpDriver(support);
