import { describe, expect, it } from "vitest";
import { modelBlurb, shortModelLabel } from "./model-friendly";

describe("model blurbs", () => {
  it("describes the well-known Claude families", () => {
    expect(modelBlurb({ id: "claude-opus-5-5", label: "Opus 5.5" })).toMatch(/Smartest/);
    expect(modelBlurb({ id: "claude-sonnet-5-5", label: "Sonnet 5.5" })).toMatch(/most work/);
    expect(modelBlurb({ id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" })).toMatch(/Quickest/);
  });

  it("calls small variants light without guessing at unknown models", () => {
    expect(modelBlurb({ id: "gpt-5-mini", label: "GPT-5 mini" })).toMatch(/light/);
    expect(modelBlurb({ id: "minimax-m2", label: "MiniMax M2" })).toBeUndefined();
    expect(modelBlurb({ id: "grok-4", label: "Grok 4" })).toBeUndefined();
  });
});

describe("short model names under a provider heading", () => {
  it("drops the provider's name a model starts with", () => {
    expect(shortModelLabel("Claude Sonnet 5", "Claude")).toBe("Sonnet 5");
    expect(shortModelLabel("Claude Fable 5.1", "Claude")).toBe("Fable 5.1");
    expect(shortModelLabel("DeepSeek Reasoner", "DeepSeek")).toBe("Reasoner");
    expect(shortModelLabel("claude opus 5.5", "Claude")).toBe("opus 5.5");
  });

  it("keeps a name the heading does not start, or whose rest would be only a version", () => {
    expect(shortModelLabel("Grok 5", "Grok")).toBe("Grok 5");
    expect(shortModelLabel("OpenAI o3", "OpenAI")).toBe("OpenAI o3");
    expect(shortModelLabel("GPT-5.6", "OpenAI")).toBe("GPT-5.6");
    expect(shortModelLabel("qwen3 (Ollama)", "Claude")).toBe("qwen3 (Ollama)");
    expect(shortModelLabel("Claudette 2", "Claude")).toBe("Claudette 2");
    expect(shortModelLabel("Claude", "Claude")).toBe("Claude");
    expect(shortModelLabel("Auto", "")).toBe("Auto");
  });
});
