// Personal answers for a new bot's setup card, written by the bot's own engine with its quick model. The card shows the
// fixed answers (initial-greeting.ts) at once; these replace them while the card is still open, and never if the reply
// is late, empty or does not read as a list of short jobs.
import type { TextGenerationOptions } from "./contracts.ts";

/** The model each engine, by driver kind, writes the suggestions with. Absent: the engine's own quick-call model
 * (Haiku on Claude). */
export const SUGGESTION_MODELS: Readonly<Record<string, string>> = {};

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

/** The engine's suggestions, or null when it cannot write them in time. */
export async function suggestSetupChoices(
  engine: { driverKind: string; generateText?: (prompt: string, options?: TextGenerationOptions) => Promise<string> },
  context: SuggestionContext,
  timeoutMs = 20_000,
): Promise<string[] | null> {
  if (!engine.generateText) return null;
  const expiry = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply = await Promise.race([
      engine.generateText(setupSuggestionPrompt(context), { signal: expiry.signal, timeoutMs, model: SUGGESTION_MODELS[engine.driverKind] }),
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
