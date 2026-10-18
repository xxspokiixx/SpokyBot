import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { GrokImportView, type GrokImportViewProps } from "./GrokImportBox";
import { TeamImportDetails } from "./TeamLibraryPanel";
import { grokImportPreview } from "@/lib/team-import";

const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const view = (overrides: Partial<GrokImportViewProps> = {}) => renderToStaticMarkup(createElement(GrokImportView, {
  url: "", card: null, loading: false, reply: "", error: "", copyState: "idle",
  onUrl: vi.fn(), onLoad: vi.fn(), onCopy: vi.fn(), onReply: vi.fn(), onPreviewReply: vi.fn(), onStarter: vi.fn(),
  ...overrides,
}));

describe("From Grok Bot", () => {
  it("shows the share card with its creator, the export prompt step, the reply box and the starter", () => {
    const markup = view({
      url: "https://x.ai/bot/d8OshqLZvtcKDcNluPuyo",
      card: { shareId: "d8OshqLZvtcKDcNluPuyo", name: "DOGE", creator: "Avid", description: "Audits your other bots.", url: "https://x.ai/bot/d8OshqLZvtcKDcNluPuyo" },
    });
    const shown = text(markup);
    expect(shown).toContain("From Grok Bot");
    expect(shown).toMatch(/DOGE by Avid Audits your other bots\. Start from description/);
    expect(shown).toContain("Copy export prompt Paste this into your Grok Bot, then paste its reply here.");
    expect(markup).toContain('aria-label="Reply from your Grok Bot"');
    expect(markup).toContain('aria-label="Grok Bot share link"');
  });

  it("offers the starter only once a card is loaded, and says when the prompt was copied", () => {
    expect(text(view())).not.toContain("Start from description");
    expect(text(view({ copyState: "copied" }))).toContain("Copied");
    expect(text(view({ error: "That Grok Bot link was not found." }))).toContain("That Grok Bot link was not found.");
  });

  it("titles what an export could not carry as Left out in the preview", () => {
    const pending = grokImportPreview({
      format: "openmaus.grok/1", name: "Overheard", instructions: "Watch for mentions.",
      routines: [{ name: "On mention", schedule: "When someone mentions the brand", prompt: "Flag it." }],
    });
    const shown = text(renderToStaticMarkup(createElement(TeamImportDetails, { pending, importedNames: ["Overheard"] })));
    expect(shown).toContain("Left out Routine “On mention”: it starts on an event, not a clock.");
    expect(shown).not.toContain("Backup notes");
  });
});
