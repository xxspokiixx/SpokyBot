// DeepSeek Harness support — DeepSeek's `dsh` (github.com/deepseek-ai/deepseek-harness)
// over ACP stdio (`dsh --profile acp`). The generic protocol runtime lives in
// acp/core.ts; this file is only the per-harness quirks. Verified against
// @deepseek-ai/dsh 0.2.1-rc.2 on 2026-10-22:
//
//   - initialize answers protocolVersion 1, authMethods [] (no sign-in step:
//     the DeepSeek key is read from DEEPSEEK_API_KEY or dsh's own
//     $DSH_HOME/.credentials.yaml), promptCapabilities.image false,
//     sessionCapabilities {close, list, resume} — resume is session/resume,
//     there is no session/load.
//   - session/new advertises two config options: `model` (category "model",
//     values are JSON pairs such as ["deepseek-official","deepseek-v4-flash"],
//     grouped per provider) and `reasoning_effort` (category "thought_level":
//     off | low | high | max). Both are set with session/set_config_option,
//     which answers with the full configOptions so the core can confirm the
//     change. That is exactly the OpenCode-shaped path (selectModel +
//     modelVariants), so model and effort need no driver code of their own.
//   - Warm boot to initialize is 1.6 s; the first boot after an install
//     creates $DSH_HOME/profiles/acp (a cold `npx` boot took ~120 s because
//     it downloaded the dependency tree, so the catalog is only probed on an
//     explicit Refresh, never at app startup).
//
// Picker ids are `<provider>/<model>` so bot settings, badges and config.json
// stay readable; resolveTurnModel turns them into dsh's wire pair just before
// the core selects the model.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ModelCatalog } from "../../contracts.ts";
import { harnessHome } from "../../env-path.ts";
import { createAcpDriver, type AcpSupport } from "./core.ts";

export const DEEPSEEK_MODELS: ModelCatalog = {
  default: "deepseek-official/deepseek-v4-flash",
  options: [
    { id: "deepseek-official/deepseek-v4-flash", label: "DeepSeek-V4-Flash" },
    { id: "deepseek-official/deepseek-flash", label: "DeepSeek-V4.1-Flash" },
    { id: "deepseek-official/deepseek-v4-pro", label: "DeepSeek-V4-Pro" },
  ],
};

/** `provider/model` → dsh's `["provider","model"]`. An id with no provider
 * is handed to dsh as-is so its own error names the problem. */
export function deepseekWireValue(pickerId: string): string {
  const slash = pickerId.indexOf("/");
  if (slash <= 0 || slash === pickerId.length - 1) return pickerId;
  return JSON.stringify([pickerId.slice(0, slash), pickerId.slice(slash + 1)]);
}

/** Inverse of deepseekWireValue; null for anything but a two-string pair. */
export function deepseekPickerId(wireValue: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(wireValue);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [provider, model] = parsed;
  if (typeof provider !== "string" || typeof model !== "string" || !provider || !model) return null;
  return `${provider}/${model}`;
}

export function dshHome(env: Record<string, string | undefined>): string {
  return env.DSH_HOME || harnessHome("dsh", env);
}

const CREDENTIAL_LINE = /^\s*DEEPSEEK_API_KEY\s*:\s*\S/m;
const DOTENV_LINE = /^\s*(?:export\s+)?DEEPSEEK_API_KEY\s*=\s*\S/m;

function fileMatches(path: string, pattern: RegExp): boolean {
  try {
    return pattern.test(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
}

/** A DeepSeek key dsh will find: the launch env, its stored credential file,
 * or its home .env (the same precedence dsh documents, read-only here). */
export function hasDeepSeekKey(env: Record<string, string | undefined>): boolean {
  if (env.DEEPSEEK_API_KEY?.trim()) return true;
  const home = dshHome(env);
  return fileMatches(join(home, ".credentials.yaml"), CREDENTIAL_LINE)
    || fileMatches(join(home, ".env"), DOTENV_LINE);
}

/** Every `value` string under a select option, descending into groups. */
function offeredWireValues(sessionConfig: unknown, configId: string): { values: string[]; current: string | null } {
  const options = (sessionConfig as { configOptions?: unknown[] } | undefined)?.configOptions;
  const option = (Array.isArray(options) ? options : []).find(
    (entry: any) => entry?.id === configId,
  ) as { currentValue?: unknown; options?: unknown } | undefined;
  const values: string[] = [];
  const collect = (entries: unknown) => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (typeof entry?.value === "string") values.push(entry.value);
      else if (Array.isArray(entry?.options)) collect(entry.options);
    }
  };
  collect(option?.options);
  return { values, current: typeof option?.currentValue === "string" ? option.currentValue : null };
}

export const deepseekSupport: AcpSupport = {
  driverKind: "deepseekAgent",
  displayName: "DeepSeek Harness",
  models: DEEPSEEK_MODELS,
  defaultCli: "dsh",
  nativeSource: "deepseek.acp",
  loginNote: "DeepSeek Harness has no DeepSeek API key — paste one under Settings → Connections → Model providers, or set DEEPSEEK_API_KEY",

  install: {
    command: {
      darwin: "npm install -g @deepseek-ai/dsh",
      linux: "npm install -g @deepseek-ai/dsh",
      win32: "npm install -g @deepseek-ai/dsh",
    },
    docsUrl: "https://github.com/deepseek-ai/deepseek-harness",
    needsNode: true,
  },

  spawnArgs: () => ["--profile", "acp"],
  credentialEnv: ["DEEPSEEK_API_KEY"],
  // Model and reasoning effort are session config options (see header).
  selectModel: { configId: "model" },
  modelVariants: true,
  resumeMethod: "resume",
  resolveModelsOnCreate: false,

  // initialize advertises no auth methods; the key rides in the child env or
  // dsh's own credential file, so there is nothing to call authenticate for.
  pickAuthMethod: () => null,
  authFailure: "continue",
  isAuthenticated: (env) => hasDeepSeekKey(env),

  resolveTurnModel: (model) => (model ? deepseekWireValue(model) : model),
  fallbackModel: (sessionConfig, catalogDefault) => {
    const { values, current } = offeredWireValues(sessionConfig, "model");
    const wanted = catalogDefault ? deepseekWireValue(catalogDefault) : "";
    if (wanted && values.includes(wanted)) return wanted;
    if (current && values.includes(current)) return current;
    return null;
  },

  // House convention for ACP harnesses: the persona rides in the prompt text.
  buildPromptText: (turn) => (turn.system ? `${turn.system}\n\n${turn.text}` : turn.text),
};

export const DeepSeekAgentDriver = createAcpDriver(deepseekSupport);
