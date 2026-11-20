import { z } from "zod";
import type { ModelCatalog, ProviderDriver } from "../contracts.ts";
import { createOpenAIChatRuntime } from "./openai-chat.ts";

// NVIDIA's hosted NIM endpoints are OpenAI-compatible on one base URL, so a person only supplies the
// key: https://build.nvidia.com/llms.txt
const DEFAULT_URL = "https://integrate.api.nvidia.com/v1";
// The tool-capable hosted models, best default first: tool calling is per model here, and a model
// without it ignores the tools array and answers in prose.
const DEFAULT_MODELS: ModelCatalog = {
  default: "openai/gpt-oss-120b",
  options: [
    { id: "openai/gpt-oss-120b", label: "GPT OSS 120B", contextWindow: 131072 },
    { id: "openai/gpt-oss-20b", label: "GPT OSS 20B", contextWindow: 131072 },
    { id: "meta/llama-3.3-70b-instruct", label: "Llama 3.3 70B", contextWindow: 131072 },
    { id: "nvidia/llama-3.3-nemotron-super-49b-v1.5", label: "Nemotron Super 49B", contextWindow: 131072 },
  ],
};
const configSchema = z.object({
  url: z.string().trim().url().default(DEFAULT_URL),
  model: z.string().trim().min(1).optional(),
  tools: z.boolean().optional(),
});
type NvidiaConfig = z.output<typeof configSchema>;

function decodeConfig(raw: unknown): NvidiaConfig {
  const config = configSchema.parse(raw ?? {});
  config.url = config.url.replace(/\/+$/, "");
  const url = new URL(config.url);
  if (url.protocol !== "https:" && !(url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new Error("NVIDIA NIM requires HTTPS, except for a local test endpoint.");
  }
  return config;
}

const modelCard = z.object({ id: z.string().trim().min(1) });

export const NvidiaDriver: ProviderDriver<NvidiaConfig> = {
  driverKind: "nvidia-nim",
  metadata: { displayName: "NVIDIA NIM", supportsMultipleInstances: true, access: "api" },
  models: DEFAULT_MODELS,
  install: {
    docsUrl: "https://build.nvidia.com/settings/api-keys",
    settings: "connections",
    signInCommand: "Save an NVIDIA API key in Settings → API keys, or set NVIDIA_API_KEY on the server.",
  },
  decodeConfig,
  defaultConfig: () => decodeConfig({}),
  async create(input) {
    const { config } = input;
    // A custom host must bring its own credential; the workspace key goes only to its own endpoint.
    const apiKey = (input.environment.NVIDIA_API_KEY ??
      (config.url === DEFAULT_URL ? process.env.NVIDIA_API_KEY : undefined) ?? "").trim();
    const known = new Map(DEFAULT_MODELS.options.map((option) => [option.id, option]));
    const withConfiguredModel = (options: ModelCatalog["options"]): ModelCatalog => {
      const preferred = config.model ?? DEFAULT_MODELS.default;
      if (config.model && !options.some((option) => option.id === config.model)) {
        options = [{ id: config.model, label: config.model }, ...options];
      }
      return { default: options.some((option) => option.id === preferred) ? preferred : options[0].id, options };
    };
    let catalog = withConfiguredModel(DEFAULT_MODELS.options);
    const refreshModels = async () => {
      if (!apiKey) return;
      try {
        const response = await fetch(`${config.url}/models`, {
          headers: { authorization: `Bearer ${apiKey}` }, redirect: "error",
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) return;
        const rows = z.object({ data: z.array(z.unknown()) }).parse(await response.json()).data;
        const options: ModelCatalog["options"] = [];
        const seen = new Set<string>();
        for (const row of rows) {
          const parsed = modelCard.safeParse(row);
          if (!parsed.success || seen.has(parsed.data.id)) continue;
          const { id } = parsed.data;
          seen.add(id);
          options.push(known.get(id) ?? { id, label: id });
        }
        // The catalogue is long and mixed; the models known to call tools stay first.
        const first = DEFAULT_MODELS.options.filter((option) => seen.has(option.id));
        const rest = options.filter((option) => !first.some((known) => known.id === option.id));
        if (options.length) catalog = withConfiguredModel([...first, ...rest]);
      } catch {}
    };
    if (apiKey) void refreshModels();
    return createOpenAIChatRuntime({
      input, driverKind: "nvidia-nim", apiKey, apiUrl: config.url,
      tools: config.tools, models: () => catalog, refreshModels, reasoning: true,
      reasoningReplayField: "reasoning", computerUse: true, imageInput: () => false,
      requestBody: (model, messages, stream) => ({ model, messages, stream }),
      httpErrorLabel: "NVIDIA NIM",
      missingKeyError: "Save an NVIDIA API key in Settings → API keys, or set NVIDIA_API_KEY.",
      unavailableReason: "No NVIDIA API key — open Settings → API keys.",
      timeoutMs: 180_000, billing: "metered", includeUsageInCompleted: true,
      nativeLog: {
        source: "nvidia.nim.chat.completions",
        outgoing: (_turn, messages, model) => ({ model, messageCount: messages.length }),
        incoming: ({ text, reasoning, usage }) => ({ textLength: text.length, reasoningLength: reasoning.length, usage }),
      },
    });
  },
};
