import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return { ...react, useState: (initial: unknown) => [initial === false ? true : initial, () => {}] };
});

const { VoicePicker } = await import("./VoicePicker");

const VOICES = [
  { id: "a".repeat(32), label: "British Narrator", description: "A calm, measured male voice" },
  { id: "b".repeat(32), label: "Studio Voice" },
];

const render = (props: Partial<Parameters<typeof VoicePicker>[0]> = {}) =>
  renderToStaticMarkup(createElement(VoicePicker, {
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

describe("VoicePicker", () => {
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
    expect(empty).toContain("No voices match");
    expect(empty).not.toContain("role=\"option\"");
  });

  it("names a selected voice the list has not loaded yet", () => {
    expect(render({ value: "c".repeat(32), voices: [] })).toContain("Current agent voice");
  });

  it("shows skeleton rows in the dropdown while the list loads, and says so in the closed field", () => {
    const markup = render({ value: "c".repeat(32), voices: [], loading: true });
    const trigger = markup.match(/<button[^>]*data-voice-picker[^>]*>.*?<\/button>/)![0];
    expect(trigger).toContain("Loading voices…");
    expect(trigger).not.toContain("animate-pulse");
    expect(markup).not.toContain("Current agent voice");
    expect(markup).not.toContain("role=\"option\"");
    expect(markup.match(/animate-pulse/g)).toHaveLength(4);
  });

  it("shows the voice being added in the closed field and holds the field until it is", () => {
    const markup = render({ value: VOICES[1].id, pending: { id: "lib-1", label: "Library Rachel", publicOwnerId: "owner2" } });
    const trigger = markup.match(/<button[^>]*data-voice-picker[^>]*>.*?<\/button>/)![0];
    expect(trigger).toContain("Library Rachel");
    expect(trigger).not.toContain("Studio Voice");
    expect(trigger).toContain("disabled");
    expect(trigger).toContain("animate-spin");
  });

  it("marks only library voices that picking would add to the account", () => {
    const markup = render({ voices: [...VOICES, { id: "lib-1", label: "Library Rachel", publicOwnerId: "owner2" }] });
    expect(markup.match(/Adds to My Voices/g)).toHaveLength(1);
    expect(markup).toMatch(/Library Rachel<\/span><span[^>]*>Adds to My Voices/);
  });
});
