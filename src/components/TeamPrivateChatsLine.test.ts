import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TeamPrivateHeader, TeamSharedHeader, teamPrivateChatsLineDue } from "./TeamPrivateChatsLine";

const memory = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};

describe("who can see a team's private chat", () => {
  it("says it in the header of every private chat", () => {
    expect(renderToStaticMarkup(createElement(TeamPrivateHeader))).toContain("Private · admins can see");
  });

  it("says, in a team bot's shared chats, that everyone in the team can see them", () => {
    expect(renderToStaticMarkup(createElement(TeamSharedHeader, { team: { name: "Acme" } }))).toContain("Shared · everyone in Acme can see");
  });

  it("says the sentence in one private chat per team, then never again on this device", () => {
    const storage = memory();
    expect(teamPrivateChatsLineDue("acme", storage)).toBe(true);
    expect(teamPrivateChatsLineDue("acme", storage)).toBe(false);
    expect(teamPrivateChatsLineDue("beta", storage)).toBe(true);
    // Storage that cannot be read: say it rather than never.
    expect(teamPrivateChatsLineDue("acme", null)).toBe(true);
    expect(teamPrivateChatsLineDue("acme", { getItem: () => { throw new Error("blocked"); }, setItem: () => {} })).toBe(true);
  });
});
