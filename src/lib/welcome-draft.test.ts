import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkEmail, clearWelcomeDraft, profilePatch, readWelcomeDraft, saveWelcomeDraft, WELCOME_DRAFT_KEY } from "./welcome-draft";

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}
let local: ReturnType<typeof storage>;
beforeEach(() => {
  local = storage();
  vi.stubGlobal("localStorage", local);
});
afterEach(() => vi.unstubAllGlobals());

describe("checkEmail", () => {
  it("treats no email as fine, and tells a valid one from one still being typed", () => {
    expect(checkEmail("")).toBe("empty");
    expect(checkEmail("   ")).toBe("empty");
    expect(checkEmail(" ada@example.com ")).toBe("valid");
    for (const typing of ["ada", "ada@", "ada@example", "ada@example.c", "a da@example.com"]) expect(checkEmail(typing), typing).toBe("invalid");
  });
});

describe("profilePatch", () => {
  it("saves a typed name and a valid email, trimmed, the email in lower case", () => {
    expect(profilePatch({ name: " Ada ", email: " Ada@Example.com " })).toEqual({ profile: { name: "Ada", email: "ada@example.com" } });
    expect(profilePatch({ name: "Ada", email: "" })).toEqual({ profile: { name: "Ada" } });
    expect(profilePatch({ name: "", email: "ada@example.com" })).toEqual({ profile: { email: "ada@example.com" } });
  });

  it("leaves out an invalid email, never writes blanks, and saves nothing already saved", () => {
    expect(profilePatch({ name: "Ada", email: "ada@" })).toEqual({ profile: { name: "Ada" } });
    expect(profilePatch({ name: "", email: "" })).toBeNull();
    expect(profilePatch({ name: "", email: "" }, { name: "Ada", email: "ada@example.com" })).toBeNull();
    expect(profilePatch({ name: "Ada", email: "ada@example.com" }, { name: "Ada", email: "ada@example.com" })).toBeNull();
    expect(profilePatch({ name: "Ada L", email: "ada@example.com" }, { name: "Ada", email: "ada@example.com" })).toEqual({ profile: { name: "Ada L" } });
  });
});

describe("the welcome draft", () => {
  it("keeps the step and the typed fields across a reload, until it is cleared", () => {
    expect(readWelcomeDraft()).toBeNull();
    saveWelcomeDraft({ beat: "engines", name: "Ada", email: "ada@" });
    expect(readWelcomeDraft()).toEqual({ beat: "engines", name: "Ada", email: "ada@" });
    clearWelcomeDraft();
    expect(readWelcomeDraft()).toBeNull();
    expect(local.values.has(WELCOME_DRAFT_KEY)).toBe(false);
  });

  it("ignores anything it did not write, such as a step from an older welcome", () => {
    for (const junk of ["{", "null", "[]", JSON.stringify({ beat: "reel", name: "Ada", email: "" }), JSON.stringify({ beat: "hello", name: 3, email: "" }),
      JSON.stringify({ beat: "hello", name: "x".repeat(2000), email: "" })]) {
      local.values.set(WELCOME_DRAFT_KEY, junk);
      expect(readWelcomeDraft(), junk.slice(0, 40)).toBeNull();
    }
  });

  it("works on without browser storage", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } });
    expect(readWelcomeDraft()).toBeNull();
    expect(() => saveWelcomeDraft({ beat: "hello", name: "", email: "" })).not.toThrow();
    expect(() => clearWelcomeDraft()).not.toThrow();
  });
});
