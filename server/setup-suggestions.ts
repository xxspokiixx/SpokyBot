// Personal answers for a new bot's setup card, written by the bot's own engine with its quick model. The card shows the
// fixed answers (initial-greeting.ts) at once; these replace them while the card is still open, and never if the reply
// is late, empty or does not read as a list of short jobs.
import type { TextGenerationOptions } from "./contracts.ts";
import { isLoopback } from "./provider-key-check.ts";
import { refusesModel } from "./quick-model-fallback.ts";

/** Each engine's quick model for the suggestions, by driver kind: the pick, then its alternates, in order. */
export const SUGGESTION_MODELS: Readonly<Record<string, readonly string[]>> = {
  claudeAgent: ["haiku", "claude-haiku-4-5"],
  codex: ["gpt-6-luna", "gpt-5.6-luna", "gpt-5.4-mini"],
  grok: ["grok-4.3", "grok-4.20-0309-non-reasoning"],
  grokAgent: ["grok-4.7", "grok-4.6"],
  antigravityAgent: ["gemini-3.8-flash-low", "gemini-3.8-flash-medium"],
  geminiAgent: ["flash-lite", "gemini-3.5-flash-lite"],
  groq: ["openai/gpt-oss-20b", "qwen/qwen3.8-27b", "llama-3.1-8b-instant"],
  cerebras: ["gpt-oss-120b", "qwen-3.8-27b"],
  mistral: ["mistral-small-latest", "ministral-8b-latest"],
  meta: ["muse-spark-1.3", "muse-spark-1.2"],
  museCode: ["muse-spark-1.3", "muse-spark-1.2"],
  minimax: ["MiniMax-M3.1-Flash", "MiniMax-M3"],
  deepseekAgent: ["deepseek-official/deepseek-flash", "deepseek-official/deepseek-v4-flash"],
  droidAgent: ["claude-haiku-5-5", "gpt-6-luna", "glm-5.3-flash"],
  cursorAgent: ["composer-2.5", "auto"],
  opencodeGo: ["opencode-go/glm-5.3-flash", "anthropic/claude-haiku-5-5"],
  qwenAgent: ["qwen3.8-flash", "qwen3.7-flash"],
  hermesAgent: ["nous:anthropic/claude-haiku-5.5", "openrouter:anthropic/claude-haiku-5.5"],
  clineAgent: ["anthropic/claude-haiku-5.5", "openai/gpt-6-luna"],
  piAgent: ["anthropic/claude-haiku-5-5", "openai/gpt-6-luna", "google/gemini-3.5-flash-lite"],
};

/** OpenAI-compatible engines: the built-in instances by id, the rest by their endpoint's host. */
const COMPATIBLE_INSTANCES: Readonly<Record<string, readonly string[]>> = {
  openai: ["gpt-6-luna", "gpt-5.6-luna", "gpt-5.4-mini"],
  openrouter: ["anthropic/claude-haiku-5.5", "openai/gpt-6-luna", "google/gemini-3.5-flash-lite"],
  "trial-credit": ["claude-haiku-5-5", "claude-haiku-4-5"],
};
const COMPATIBLE_HOSTS: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/(^|\.)openrouter\.ai$/, COMPATIBLE_INSTANCES.openrouter!],
  [/(^|\.)api\.openai\.com$/, COMPATIBLE_INSTANCES.openai!],
  [/(^|\.)api\.deepseek\.com$/, ["deepseek-flash"]],
  [/(^|\.)api\.together\.(ai|xyz)$/, ["deepseek-ai/DeepSeek-V4.1-Flash-1017"]],
  [/(^|\.)api\.fireworks\.ai$/, ["accounts/fireworks/models/deepseek-v4p1-flash-1017"]],
  [/(^|\.)api\.deepinfra\.com$/, ["deepseek-ai/DeepSeek-V4.1-Flash-1017"]],
  [/(^|\.)api\.z\.ai$/, ["glm-5.3-flash"]],
  [/(^|\.)api\.moonshot\.ai$/, ["kimi-k3.1-pro-highspeed"]],
  [/^dashscope[\w-]*\.aliyuncs\.com$/, ["qwen3.8-flash"]],
];
/** A custom ACP agent: its first model matching the earliest of these. */
const ACP_PREFERENCE = [/haiku/i, /gpt-6-luna/i, /flash-lite/i, /flash/i, /lite/i, /fast/i];

export interface SuggestionEngine {
  instanceId: string;
  driverKind: string;
  /** The ids in the engine's live model list. */
  catalog: readonly string[];
  /** An OpenAI-compatible endpoint's host. */
  host?: string;
  /** False on a sign-in that refuses small models (Codex on a ChatGPT account). */
  quickModelsUsable: boolean;
}

const privateHost = (host: string) => isLoopback(host) || host.endsWith(".local")
  || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host);

function candidates(engine: SuggestionEngine): readonly string[] {
  if (engine.driverKind === "customAcp") {
    for (const pattern of ACP_PREFERENCE) {
      const id = engine.catalog.find((option) => pattern.test(option));
      if (id) return [id];
    }
    return [];
  }
  if (engine.driverKind !== "openai-compat") return SUGGESTION_MODELS[engine.driverKind] ?? [];
  return COMPATIBLE_INSTANCES[engine.instanceId] ?? COMPATIBLE_HOSTS.find(([host]) => engine.host && host.test(engine.host))?.[1] ?? [];
}

/** The model to ask: the family's pick or the first usable alternate. The bot's own model where small ones cannot be
 * used or the engine is on this computer or its network, and undefined to leave the choice to the engine. A pick is
 * usable when the live list names it (a bare alias such as "haiku", when it names one of that family), this instance
 * has not refused it, and the place's model policy allows it; a free model never gets the person's details. */
export function suggestionModel(engine: SuggestionEngine, own: string | undefined, refused: ReadonlySet<string>,
  allowed: (model: string) => boolean): string | undefined {
  if (!engine.quickModelsUsable || (engine.host && privateHost(engine.host))) return own;
  const listed = (id: string) => engine.catalog.includes(id) || (/^[a-z-]+$/.test(id) && engine.catalog.some((option) => option.includes(id)));
  return candidates(engine).find((id) => !/[-:]free$/.test(id) && listed(id) && !refused.has(id) && allowed(id));
}

export interface SuggestionContext {
  botName: string;
  /** What the person has told the app about themselves (Settings → About me). */
  aboutMe: string;
  /** Their other bots, as "Name (title)". */
  otherBots: readonly string[];
  /** The app's language, which the answers are written in. */
  language: string | undefined;
}

const COUNT = 5;
const MIN_COUNT = 3;
const MAX_LENGTH = 60;

export function setupSuggestionPrompt(context: SuggestionContext): string {
  return [
    `A person just made a new assistant bot called ${context.botName}. It has no job yet.`,
    `Suggest the ${COUNT} jobs they would most likely want it to help with first, as short plain phrases of 3 to 7 words,`,
    "one per line, with no numbers, bullets, quotes or closing punctuation. Prefer everyday jobs to technical ones, and",
    "leave out jobs their other bots already do.",
    `Write them in the language with this code: ${context.language?.trim() || "en"}.`,
    "",
    `About the person: ${context.aboutMe.trim() || "nothing yet"}`,
    `Their other bots: ${context.otherBots.length ? context.otherBots.join("; ") : "none"}`,
  ].join("\n");
}

/** The reply as up to five short, distinct jobs; null unless at least three read as one. */
export function parseSetupSuggestions(reply: string): string[] | null {
  const seen = new Set<string>();
  const jobs: string[] = [];
  for (const raw of reply.split(/\r?\n/)) {
    const job = raw.replace(/^\s*(?:[-*•]|\d+[.)]|[A-Ea-e][.)])\s*/, "").replace(/^["'“]|["'”]$/g, "").replace(/[.;:]+$/, "").trim();
    if (job.length < 3 || job.length > MAX_LENGTH || seen.has(job.toLowerCase())) continue;
    seen.add(job.toLowerCase());
    jobs.push(job);
    if (jobs.length === COUNT) break;
  }
  return jobs.length >= MIN_COUNT ? jobs : null;
}

export interface SuggestionRoute {
  /** suggestionModel's choice. */
  model?: string;
  /** The bot's own model, which a refused quick model is retried on once. */
  own?: string;
  refused: ReadonlySet<string>;
  onRefused: (model: string) => void;
}

/** The engine's suggestions, or null when it cannot write them in time. */
export async function suggestSetupChoices(
  generateText: (prompt: string, options?: TextGenerationOptions) => Promise<string>,
  context: SuggestionContext,
  route: SuggestionRoute,
  timeoutMs = 20_000,
): Promise<string[] | null> {
  const expiry = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ask = (model: string | undefined) => generateText(setupSuggestionPrompt(context), {
    signal: expiry.signal, timeoutMs, ...(model ? { model } : {}),
    fallback: { ...(route.own ? { model: route.own } : {}), refused: route.refused, onRefused: route.onRefused },
  });
  const write = async () => {
    try {
      return await ask(route.model);
    } catch (error) {
      const model = route.model;
      if (!model || model === route.own || !refusesModel(error instanceof Error ? error.message : String(error), model)) throw error;
      route.onRefused(model);
      return ask(route.own);
    }
  };
  try {
    const reply = await Promise.race([
      write(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expiry.abort();
          reject(new Error("setup suggestions timed out"));
        }, timeoutMs);
      }),
    ]);
    return parseSetupSuggestions(reply);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
