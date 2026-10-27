import { describe, expect, it, vi } from "vitest";

import { parseSetupSuggestions, setupSuggestionPrompt, suggestSetupChoices, SUGGESTION_MODELS } from "./setup-suggestions.ts";

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

  it("use the engine's quick model, or the one named for its kind, and give up on a late or failed reply", async () => {
    const generateText = vi.fn(async (_prompt: string, _options?: { model?: string; timeoutMs?: number }) => "Track daily orders\nChase unpaid invoices\nPlan the weekly bake");
    expect(await suggestSetupChoices({ driverKind: "claudeAgent", generateText }, context)).toEqual(["Track daily orders", "Chase unpaid invoices", "Plan the weekly bake"]);
    expect(generateText.mock.calls[0]![1]).toMatchObject({ model: SUGGESTION_MODELS.claudeAgent, timeoutMs: 20_000 });
    expect(await suggestSetupChoices({ driverKind: "x" }, context)).toBeNull();
    expect(await suggestSetupChoices({ driverKind: "x", generateText: async () => { throw new Error("offline"); } }, context)).toBeNull();
    expect(await suggestSetupChoices({ driverKind: "x", generateText: () => new Promise<string>(() => {}) }, context, 10)).toBeNull();
  });
});
