import { describe, expect, it, vi } from "vitest";

import { parseSetupSuggestions, setupSuggestionPrompt, suggestSetupChoices, suggestionModel, type SuggestionEngine } from "./setup-suggestions.ts";

const context = { botName: "Scout", aboutMe: "I run a small bakery and do my own books.", otherBots: ["Ivy (Inbox helper)"], language: "es" };

describe("personal answers for a new bot's setup card", () => {
  it("ask for five short everyday jobs from what the person said, leaving out their other bots' jobs, in the app's language", () => {
    const prompt = setupSuggestionPrompt(context);
    for (const part of ["Scout", "5 jobs", "bakery", "Ivy (Inbox helper)", "leave out jobs their other bots already do", "code: es"]) {
      expect(prompt).toContain(part);
    }
    expect(setupSuggestionPrompt({ ...context, aboutMe: " ", otherBots: [], language: undefined })).toContain("About the person: nothing yet");
  });

  it("read the reply as up to five short distinct jobs, and give up unless three read as one", () => {
    expect(parseSetupSuggestions("1. Track daily orders.\n- Chase unpaid invoices\n• \"Plan the weekly bake\"\nB) Chase unpaid invoices\nok\n"
      + "Answer customer messages\nWatch flour prices\nKeep the books")).toEqual([
      "Track daily orders", "Chase unpaid invoices", "Plan the weekly bake", "Answer customer messages", "Watch flour prices",
    ]);
    expect(parseSetupSuggestions(`One job\n${"x".repeat(61)}\nTwo jobs`)).toBeNull();
  });

  it("ask on the chosen model, retry once on the bot's own model when that one is refused and remember it, and give up on a late or failed reply", async () => {
    const onRefused = vi.fn();
    const route = { model: "haiku", own: "claude-sonnet-5", refused: new Set<string>(), onRefused };
    const jobs = "Track daily orders\nChase unpaid invoices\nPlan the weekly bake";
    const generateText = vi.fn(async (_prompt: string, options?: { model?: string; timeoutMs?: number; fallback?: { model?: string } }) => {
      if (options?.model === "haiku") throw new Error("400 invalid_request_error: model haiku is not available");
      return jobs;
    });
    expect(await suggestSetupChoices(generateText, context, route)).toEqual(["Track daily orders", "Chase unpaid invoices", "Plan the weekly bake"]);
    expect(generateText.mock.calls.map(([, options]) => options?.model)).toEqual(["haiku", "claude-sonnet-5"]);
    expect(generateText.mock.calls[0]![1]).toMatchObject({ timeoutMs: 20_000, fallback: { model: "claude-sonnet-5" } });
    expect(onRefused).toHaveBeenCalledExactlyOnceWith("haiku");
    expect(await suggestSetupChoices(async () => { throw new Error("offline"); }, context, route)).toBeNull();
    expect(await suggestSetupChoices(() => new Promise<string>(() => {}), context, route, 10)).toBeNull();
  });
});

describe("the quick model the suggestions are written on", () => {
  const engine = (driverKind: string, catalog: string[], extra: Partial<SuggestionEngine> = {}): SuggestionEngine =>
    ({ instanceId: driverKind, driverKind, catalog, quickModelsUsable: true, ...extra });
  const pick = (of: SuggestionEngine, refused: string[] = [], allowed: (model: string) => boolean = () => true) =>
    suggestionModel(of, "own-model", new Set(refused), allowed);

  it("is each family's pick from the table, by kind of engine, instance or host", () => {
    expect(pick(engine("claudeAgent", ["claude-sonnet-5", "claude-haiku-5-5"])), "a bare alias is listed by its family").toBe("haiku");
    expect(pick(engine("codex", ["gpt-6", "gpt-6-luna"]))).toBe("gpt-6-luna");
    expect(pick(engine("openai-compat", ["anthropic/claude-haiku-5.5"], { instanceId: "openrouter" }))).toBe("anthropic/claude-haiku-5.5");
    expect(pick(engine("openai-compat", ["deepseek-flash"], { instanceId: "mine", host: "api.deepseek.com" }))).toBe("deepseek-flash");
    expect(pick(engine("customAcp", ["big-model", "fast-model", "my-flash"]))).toBe("my-flash");
  });

  it("falls to an alternate when the pick is not in the live list, or this instance refused it, or the policy forbids it", () => {
    expect(pick(engine("codex", ["gpt-6", "gpt-5.4-mini"]))).toBe("gpt-5.4-mini");
    expect(pick(engine("claudeAgent", ["claude-haiku-4-5", "claude-haiku-5-5"]), ["haiku"])).toBe("claude-haiku-4-5");
    expect(pick(engine("codex", ["gpt-6-luna", "gpt-5.6-luna"]), [], (model) => model !== "gpt-6-luna")).toBe("gpt-5.6-luna");
  });

  it("leaves the choice to the engine when nothing in the table is usable, and never picks a free model", () => {
    expect(pick(engine("codex", ["gpt-6"]))).toBeUndefined();
    expect(pick(engine("unknownAgent", ["anything"]))).toBeUndefined();
    expect(pick(engine("openai-compat", ["x"], { instanceId: "mine", host: "relay.example.com" }))).toBeUndefined();
    expect(pick(engine("customAcp", ["big-model"]))).toBeUndefined();
    expect(pick(engine("customAcp", ["fast-free"]))).toBeUndefined();
  });

  it("stays on the bot's own model where small ones cannot be used or the engine runs on this computer or its network", () => {
    expect(pick(engine("codex", ["gpt-6-luna"], { quickModelsUsable: false }))).toBe("own-model");
    for (const host of ["localhost", "127.0.0.1", "192.168.1.20", "studio.local"]) {
      expect(pick(engine("openai-compat", ["gpt-6-luna", "gemma4:e4b"], { instanceId: "mine", host }))).toBe("own-model");
    }
  });
});
