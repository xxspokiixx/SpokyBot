import { antigravityAccount } from "./antigravity-account.js";
import { createAcpDriver } from "./acp/core.js";
import { AntigravityAuthController, antigravityProfileAuthenticated, prepareAntigravityProfile, probeAntigravityModels, validateAntigravityRuntime, } from "./antigravity-acp.js";
import { antigravityManagedInstallAvailable, installAntigravityRuntime, resolveAntigravityRuntime, } from "./antigravity-runtime.js";
import { resolveAntigravityReleaseAsset } from "./antigravity-release.js";
import { VERIFICATION_TEMP_KEY, scheduleAntigravityTempSweep } from "./antigravity-temp.js";
import { augmentedPath } from "../env-path.js";
export const STATIC_ANTIGRAVITY_MODELS = {
    default: "gemini-3.8-flash",
    options: [
        {
            id: "gemini-3.8-flash",
            label: "Gemini 3.8 Flash",
            variants: [
                { id: "low", label: "Low" },
                { id: "medium", label: "Medium" },
                { id: "high", label: "High" },
            ],
        },
    ],
};
/** Bots saved before the thinking-level option hold `gemini-3.8-flash-{low,medium,high}`; the official runtime
 * offers only the base model with that option, so run the base at the saved level. A runtime that still offers
 * the suffixed id, or a turn that chose its own level, keeps its selection. */
export function normalizeAntigravityTurn(turn, offeredModels) {
    if (turn.variant !== undefined)
        return turn;
    const match = turn.model?.match(/^(gemini-3\.8-flash)-(low|medium|high)$/u);
    return match && offeredModels.includes(match[1]) && !offeredModels.includes(match[0])
        ? { ...turn, model: match[1], variant: match[2] }
        : turn;
}
/** Antigravity's session modes: `yolo` for Full, `auto_edit` for auto-accept edits, `default` otherwise (it has no reviewer for Auto). */
export function antigravityPermissionMode(fullAuto, approvalMode) {
    if (fullAuto || approvalMode === "full")
        return "yolo";
    return approvalMode === "edits" ? "auto_edit" : "default";
}
const managedAsset = resolveAntigravityReleaseAsset();
const support = {
    driverKind: "antigravityAgent",
    // Named for what people look for: Google moved personal Gemini subscriptions (free, AI Pro, AI Ultra) from Gemini CLI to Antigravity on 2026-06-18.
    displayName: "Google Gemini (Antigravity)",
    models: STATIC_ANTIGRAVITY_MODELS,
    defaultCli: "agy", // migration alias: resolveAntigravityRuntime treats it as managed
    nativeSource: "antigravity.acp",
    loginNote: "Antigravity needs a Google account — choose Sign in with Google in engine setup",
    install: {
        docsUrl: "https://github.com/agentclientprotocol/registry/tree/main/antigravity-acp",
        ...(managedAsset
            ? { managed: { label: "Install official Antigravity", downloadBytes: managedAsset.archiveBytes } }
            : {}),
    },
    images: true,
    spawnArgs: () => [],
    selectModel: { configId: "model" },
    modelVariants: true,
    normalizeSessionSelection: normalizeAntigravityTurn,
    // Google's server reads its new-session default from this variable (agy_acp_server 1.4.3
    // model_selection.get_default_model_id); a later switch re-fetches the model list (1.3-1.8 s).
    sessionModelEnv: "AGY_ACP_DEFAULT_MODEL",
    sessionScopedApproval: true,
    resumeMethod: "resume",
    clientFileSystem: true,
    redactStderr: true,
    sanitizeToolPayload: true,
    resolveModelsOnCreate: false,
    resolveCommand: async (env, config, instanceId) => {
        const runtime = await resolveAntigravityRuntime(config.cli, env);
        const profile = await prepareAntigravityProfile({ instanceId, runtime, baseEnv: env });
        if (profile.tempDirectory)
            scheduleAntigravityTempSweep(instanceId);
        return {
            command: runtime.executablePath,
            args: process.platform === "linux" ? ["--uid="] : [],
            env: profile.environment,
        };
    },
    resolveModels: async (env, config, instanceId) => {
        const runtime = await resolveAntigravityRuntime(config.cli, env);
        const profile = await prepareAntigravityProfile({ instanceId, runtime, baseEnv: env });
        if (!(await antigravityProfileAuthenticated(profile)))
            throw new Error(support.loginNote);
        return probeAntigravityModels({
            runtime,
            profile,
            fallbackDefault: STATIC_ANTIGRAVITY_MODELS.default,
        });
    },
    pickAuthMethod: (methods) => methods.some((method) => method.id === "oauth-personal")
        ? "oauth-personal"
        : null,
    authFailure: "fail",
    requireAuthenticationBeforeSpawn: true,
    isAuthenticated: async (env, config, instanceId) => {
        try {
            const runtime = await resolveAntigravityRuntime(config.cli, env);
            const profile = await prepareAntigravityProfile({ instanceId, runtime, baseEnv: env });
            return antigravityProfileAuthenticated(profile);
        }
        catch {
            return false;
        }
    },
    snapshot: async (env, config, instanceId) => {
        try {
            const runtime = await resolveAntigravityRuntime(config.cli, env);
            const profile = await prepareAntigravityProfile({ instanceId, runtime, baseEnv: env });
            return {
                state: "available",
                version: runtime.version,
                authenticated: await antigravityProfileAuthenticated(profile),
                account: await antigravityAccount(profile.tokenPath),
            };
        }
        catch (error) {
            return { state: "unavailable", reason: error instanceof Error ? error.message : String(error) };
        }
    },
    configureSession: async ({ request, sessionId, config, turn, configOptions }) => {
        if (!Array.isArray(configOptions) || !configOptions.some(option => option?.id === "mode")) {
            return;
        }
        const wanted = antigravityPermissionMode(config.fullAuto, turn.approvalMode);
        const result = await request("session/set_config_option", {
            sessionId,
            configId: "mode",
            value: wanted,
        });
        const mode = Array.isArray(result?.configOptions)
            ? result.configOptions.find((option) => option?.id === "mode")?.currentValue
            : undefined;
        if (mode !== wanted)
            throw new Error(`Antigravity did not apply ${wanted} permission mode.`);
    },
};
const AcpAntigravityDriver = createAcpDriver(support);
export const AntigravityDriver = {
    ...AcpAntigravityDriver,
    async create(input) {
        const base = await AcpAntigravityDriver.create(input);
        scheduleAntigravityTempSweep(input.instanceId);
        scheduleAntigravityTempSweep(VERIFICATION_TEMP_KEY);
        const auth = new AntigravityAuthController();
        let installFailure;
        const runtimeAndProfile = async () => {
            // A GUI launch's raw PATH may omit the official runtime the model picker found.
            const environment = { ...process.env, ...input.environment, PATH: augmentedPath() };
            const runtime = await resolveAntigravityRuntime(input.config.cli, environment);
            const profile = await prepareAntigravityProfile({
                instanceId: input.instanceId,
                runtime,
                baseEnv: environment,
            });
            return { runtime, profile };
        };
        return {
            ...base,
            get models() {
                return base.models;
            },
            snapshot: async () => {
                const snapshot = await base.snapshot();
                if (snapshot.state === "available")
                    installFailure = undefined;
                return snapshot.state === "unavailable" && installFailure
                    ? { ...snapshot, reason: installFailure }
                    : snapshot;
            },
            ...(antigravityManagedInstallAvailable()
                ? {
                    installRuntime: async () => {
                        installFailure = undefined;
                        try {
                            await installAntigravityRuntime({ validate: validateAntigravityRuntime });
                        }
                        catch (error) {
                            installFailure = error instanceof Error ? error.message : String(error);
                            throw error;
                        }
                    },
                }
                : {}),
            startAuthentication: async () => {
                const { runtime, profile } = await runtimeAndProfile();
                return auth.start(runtime, profile);
            },
            completeAuthentication: async (flowId, callbackUrl) => auth.complete(flowId, callbackUrl),
            cancelAuthentication: async () => auth.cancel(),
            dispose: async () => {
                auth.cancel();
                await base.dispose();
            },
        };
    },
};
