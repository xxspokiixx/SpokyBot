import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return { ...react, useState: (initial: unknown) => [initial === false ? true : initial, () => {}] };
});

const { FishVoicePicker } = await import("./FishVoicePicker");

const VOICES = [
  { id: "a".repeat(32), label: "British Narrator", description: "A calm, measured male voice" },
  { id: "b".repeat(32), label: "Studio Voice" },
];

const render = (props: Partial<Parameters<typeof FishVoicePicker>[0]> = {}) =>
  renderToStaticMarkup(createElement(FishVoicePicker, {
    value: "",
    voices: VOICES,
    loading: false,
    query: "",
    onQuery: () => {},
    onPick: () => {},
    defaultLabel: "Pick a voice",
    ariaLabel: "Pepper's voice",
    ...props,
  }));

describe("FishVoicePicker", () => {
  it("opens with the search box above every voice and its description", () => {
    const markup = render({ value: VOICES[0].id });
    expect(markup.indexOf("type=\"search\"")).toBeLessThan(markup.indexOf("role=\"listbox\""));
    expect(markup).toContain("A calm, measured male voice");
    expect(markup.match(/role="option"/g)).toHaveLength(3);
    expect(markup).toMatch(/aria-selected="true"[^>]*>.*British Narrator/);
  });

  it("drops the default row while searching and says when nothing matches", () => {
    expect(render({ query: "studio" }).match(/role="option"/g)).toHaveLength(2);
    const empty = render({ query: "zzzz", voices: [] });
    expect(empty).toContain("No Fish Audio voices match");
    expect(empty).not.toContain("role=\"option\"");
  });

  it("names a selected voice the list has not loaded yet", () => {
    expect(render({ value: "c".repeat(32), voices: [] })).toContain("Current agent voice");
  });
});
