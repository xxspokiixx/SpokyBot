import type { ChatProvider, ChatRequest, ChatChunk, ModelRef, ValidationResult } from "./types.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { providerRegistry } from "./registry.ts";

const NVIDIA_NIM_API_KEY_ENVS = ["NVIDIA_NIM_API_KEY", "OMB_NVIDIA_NIM_API_KEY"];
const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";

const NVIDIA_NIM_MODELS: ModelRef[] = [
  { id: "nvidia/nemotron-3-ultra", label: "Nemotron 3 Ultra (Reasoning)", contextWindow: 128000 },
  { id: "nvidia/llama-3.1-405b-instruct", label: "Llama 3.1 405B Instruct", contextWindow: 128000 },
  { id: "nvidia/llama-3.1-70b-instruct", label: "Llama 3.1 70B Instruct", contextWindow: 128000 },
  { id: "nvidia/llama-3.1-8b-instruct", label: "Llama 3.1 8B Instruct", contextWindow: 128000 },
  { id: "nvidia/nemotron-4-340b-instruct", label: "Nemotron 4 340B Instruct (Coding)", contextWindow: 128000 },
  { id: "mistralai/mistral-large", label: "Mistral Large (via NIM)", contextWindow: 128000 },
  { id: "meta/llama-3.2-3b-instruct", label: "Llama 3.2 3B Instruct (Edge)", contextWindow: 128000 },
];

interface StreamChunk {
  choices?: Array<{
    index?: number;
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: unknown;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

class NvidiaNimProviderClass implements ChatProvider {
  readonly id = "nvidia-nim";
  readonly displayName = "NVIDIA NIM";
  readonly models = NVIDIA_NIM_MODELS;

  private readConfig(): { key?: string; baseUrl?: string } {
    const dataDir = process.env.OMB_DATA_DIR || join(homedir(), ".openmausbot");
    try {
      const raw = readFileSync(join(dataDir, "config.json"), "utf8").replace(/^\uFEFF/, "");
      const parsed = JSON.parse(raw) as { nvidiaNim?: { key?: string; baseUrl?: string } };
      return parsed?.nvidiaNim ?? {};
    } catch {
      return {};
    }
  }

  private getApiKey(): string | undefined {
    for (const env of NVIDIA_NIM_API_KEY_ENVS) {
      const value = process.env[env];
      if (value) return value;
    }
    const fromConfig = this.readConfig().key;
    if (fromConfig) return fromConfig;
    return undefined;
  }

  private getBaseUrl(): string {
    return process.env.NVIDIA_NIM_BASE_URL || this.readConfig().baseUrl || DEFAULT_BASE_URL;
  }

  async validateCredentials(): Promise<ValidationResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return { valid: false, error: "No API key found. Set NVIDIA_NIM_API_KEY or OMB_NVIDIA_NIM_API_KEY." };
    }

    try {
      const response = await fetch(`${this.getBaseUrl()}/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        if (response.status === 401 || response.status === 403) {
          return { valid: false, error: "Invalid API key" };
        }
        return { valid: false, error: `HTTP ${response.status}: ${body || "Unknown error"}` };
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : "Failed to validate credentials" };
    }
  }

  async listModels(): Promise<ModelRef[]> {
    const apiKey = this.getApiKey();
    if (!apiKey) return this.models;

    try {
      const response = await fetch(`${this.getBaseUrl()}/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8_000),
      });

      if (!response.ok) return this.models;

      const json = await response.json() as { data?: Array<{ id: string; name?: string }> } | Array<{ id: string; name?: string }>;
      const rows = Array.isArray(json) ? json : json.data ?? [];

      const seen = new Set<string>();
      const options: ModelRef[] = [];

      for (const row of rows) {
        const id = row.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);

        // Filter to only include known NVIDIA NIM models
        const knownModel = this.models.find(m => m.id === id);
        if (knownModel) {
          options.push(knownModel);
        } else {
          options.push({
            id,
            label: row.name || id,
            custom: true,
          });
        }
      }

      return options.length > 0 ? options : this.models;
    } catch {
      return this.models;
    }
  }

  async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      yield { type: "error", error: "No API key found. Set NVIDIA_NIM_API_KEY or OMB_NVIDIA_NIM_API_KEY." };
      return;
    }

    const messages = this.convertMessages(request.messages);
    const known = this.models.find((m) => m.id === request.model);
    // Fall back to the default NIM model when the caller asks for an unknown (e.g. Anthropic/OpenAI) model name.
    const resolvedModel = known ? request.model! : this.models[0].id;

    try {
      const response = await fetch(`${this.getBaseUrl()}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: resolvedModel,
          messages,
          stream: true,
          stream_options: { include_usage: true },
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens,
          ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
        }),
        signal: AbortSignal.timeout(180_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        yield { type: "error", error: `HTTP ${response.status}: ${body || "Unknown error"}` };
        return;
      }

      if (!response.body) {
        yield { type: "error", error: "No response body" };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            const line = buffer.trim();
            if (line && line !== "data: [DONE]") {
              const chunks = Array.from(this.processLine(line, true));
              for (const chunk of chunks) {
                yield chunk;
              }
            }
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            let shouldBreak = false;
            const chunks = Array.from(this.processLine(line));
            for (const chunk of chunks) {
              yield chunk;
              if (chunk.type === "error") shouldBreak = true;
            }
            if (shouldBreak) break;
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }

      yield { type: "done" };
    } catch (error) {
      yield { type: "error", error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  private *processLine(line: string, atEof = false): Iterable<ChatChunk> {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return;

    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      if (!atEof) return;
      return;
    }

    const choice = chunk.choices?.[0];
    if (!choice) return;

    const delta = choice.delta;
    if (delta?.content) {
      yield { type: "delta", content: delta.content };
    }
    if (delta?.reasoning_content) {
      yield { type: "delta", reasoning: delta.reasoning_content };
    }
    if (delta?.tool_calls) {
      yield { type: "delta", toolCalls: delta.tool_calls as ChatChunk["toolCalls"] };
    }
    if (chunk.usage) {
      yield {
        type: "delta",
        usage: {
          input: chunk.usage.prompt_tokens ?? 0,
          output: chunk.usage.completion_tokens ?? 0,
          cachedInput: chunk.usage.prompt_tokens_details?.cached_tokens,
        },
      };
    }
  }

  private convertMessages(messages: ChatRequest["messages"]): any[] {
    return messages.map(msg => {
      const base: any = { role: msg.role };
      if (typeof msg.content === "string") {
        base.content = msg.content;
      } else {
        base.content = msg.content.map(part => {
          if (part.type === "text") {
            return { type: "text", text: part.text };
          } else if (part.type === "image" && part.image) {
            return { type: "image_url", image_url: { url: `data:${part.image.mimeType};base64,${part.image.data}` } };
          }
          return { type: "text", text: "" };
        });
      }
      if (msg.toolCalls) {
        base.tool_calls = msg.toolCalls;
      }
      if (msg.toolCallId) {
        base.tool_call_id = msg.toolCallId;
      }
      return base;
    });
  }
}

export const NvidiaNimProvider = new NvidiaNimProviderClass();
providerRegistry.register(NvidiaNimProvider);
