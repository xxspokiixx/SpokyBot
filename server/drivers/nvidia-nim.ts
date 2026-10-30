// NVIDIA NIM driver — speaks the OpenAI chat-completions contract.
import type { ModelCatalog, ProviderDriver } from "../contracts.ts";
import { createOpenAIChatRuntime } from "./openai-chat.ts";

const DRIVER_KIND = "nvidia-nim";
const DEFAULT_IDLE_TIMEOUT_MS = 180_000;

const DEFAULT_MODELS: ModelCatalog = {
  default: "nvidia/nemotron-3-ultra",
  options: [
    { id: "nvidia/nemotron-3-ultra", label: "Nemotron 3 Ultra (Reasoning)", contextWindow: 128000 },
    { id: "nvidia/llama-3.1-405b-instruct", label: "Llama 3.1 405B Instruct", contextWindow: 128000 },
    { id: "nvidia/llama-3.1-70b-instruct", label: "Llama 3.1 70B Instruct", contextWindow: 128000 },
    { id: "nvidia/llama-3.1-8b-instruct", label: "Llama 3.1 8B Instruct", contextWindow: 128000 },
    { id: "nvidia/nemotron-4-340b-instruct", label: "Nemotron 4 340B Instruct (Coding)", contextWindow: 128000 },
    { id: "mistralai/mistral-large", label: "Mistral Large (via NIM)", contextWindow: 128000 },
    { id: "meta/llama-3.2-3b-instruct", label: "Llama 3.2 3B Instruct (Edge)", contextWindow: 128000 },
  ],
};

const DEFAULT_KEY_ENV = "NVIDIA_NIM_API_KEY";
const DEFAULT_URL = "https://integrate.api.nvidia.com/v1";

export interface NvidiaNimConfig {
  tools?: boolean;
  url: string;
  apiKeyEnv: string;
  key?: string;
  model?: string;
}

function decodeConfig(raw: unknown): NvidiaNimConfig {
  const config = (raw ?? {}) as Record<string, unknown>;
  if (config.tools !== undefined && typeof config.tools !== "boolean") throw new Error("tools must be a boolean");
  const envUrl = process.env.NVIDIA_NIM_BASE_URL;
  return {
    ...(config.tools !== undefined ? { tools: config.tools as boolean } : {}),
    url: (typeof config.url === "string" && config.url ? config.url : envUrl || DEFAULT_URL).replace(/\/+$/, ""),
    apiKeyEnv: typeof config.apiKeyEnv === "string" && config.apiKeyEnv ? config.apiKeyEnv : DEFAULT_KEY_ENV,
    key: typeof config.key === "string" && config.key ? config.key : undefined,
    model: typeof config.model === "string" && config.model ? config.model : undefined,
  };
}

export const NvidiaNimDriver: ProviderDriver<NvidiaNimConfig> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "NVIDIA NIM",
    supportsMultipleInstances: false,
    access: "api",
  },
  models: DEFAULT_MODELS,
  install: {
    docsUrl: "https://www.nvidia.com/en-us/nim/",
    settings: "connections",
    signInCommand: "Add your NVIDIA NIM API key in Settings → NVIDIA NIM, or set NVIDIA_NIM_API_KEY on the server.",
  },
  decodeConfig,
  defaultConfig: () => decodeConfig({}),

  async create(input) {
    const { config } = input;
    const apiKey =
      config.key ??
      input.environment[config.apiKeyEnv] ??
      process.env[config.apiKeyEnv] ??
      "";
    const missingKey = "No NVIDIA NIM API key — open Settings → NVIDIA NIM.";

    const fetchModels = async () => {
      if (!apiKey) return;
      try {
        const response = await fetch(`${config.url}/models`, {
          headers: { authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) return;
        type Row = { id: string; name?: string };
        const json = await response.json() as { data?: Row[] } | Row[];
        let rows = Array.isArray(json) ? json : Array.isArray(json.data) ? json.data : [];
        const seen = new Set<string>();
        const options: ModelCatalog["options"] = [];
        for (const row of rows) {
          const id = typeof row.id === "string" ? row.id : "";
          if (!id || seen.has(id)) continue;
          seen.add(id);
          // Only include known NVIDIA NIM models
          const knownModel = DEFAULT_MODELS.options.find(m => m.id === id);
          if (knownModel) {
            options.push(knownModel);
          } else {
            options.push({
              id,
              label: typeof row.name === "string" && row.name.trim() ? row.name : id,
              custom: true,
            });
          }
        }
        if (!options.length) return;
        if (config.model && !options.some((model) => model.id === config.model)) {
          options.unshift({ id: config.model, label: config.model, custom: true });
        }
        catalog = { default: config.model ?? options[0].id, options };
      } catch {}
    };

    const runtime = createOpenAIChatRuntime({
      input,
      driverKind: DRIVER_KIND,
      apiKey,
      apiUrl: config.url,
      tools: config.tools,
      computerUse: true,
      nudgeAnnouncedAction: true,
      models: () => catalog,
      refreshModels: fetchModels,
      requestBody: (model, messages, stream) => ({
        model,
        messages,
        stream,
        stream_options: stream ? { include_usage: true } : undefined,
        temperature: 0.7,
      }),
      httpErrorLabel: "upstream",
      missingKeyError: missingKey,
      unavailableReason: missingKey,
      timeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
      reasoning: true,
      billing: "metered",
      includeUsageInCompleted: true,
      nativeLog: {
        source: "nvidia-nim.chat.completions",
        outgoing: (_turn, messages, model, tools) => ({
          model,
          messageCount: messages.length,
          tools: tools.map(tool => tool.function.name),
        }),
        incoming: ({ text, reasoning, usage }) => ({
          textLength: text.length,
          reasoningLength: reasoning.length,
          usage,
        }),
      },
    });
    return runtime;
  },
};

let catalog = DEFAULT_MODELS;