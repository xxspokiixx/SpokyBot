import { describe, expect, it } from "vitest";
import type { AppState } from "@/state/store";
import { firstReplyPending } from "./corner-popup";

const state = (bots: unknown[], groups: unknown[] = []) => ({ bots, groups }) as unknown as Pick<AppState, "bots" | "groups">;

describe("firstReplyPending", () => {
  it("holds while no bot or room has finished a turn", () => {
    expect(firstReplyPending(state([]))).toBe(true);
    expect(firstReplyPending(state([{ tasks: [] }, { tasks: [{ threadId: "t", usage: { turns: 0 } }] }], [{ usage: null }]))).toBe(true);
  });

  it("lets go once a bot or a room has answered", () => {
    expect(firstReplyPending(state([{ tasks: [{ threadId: "a" }, { threadId: "b", usage: { turns: 1 } }] }]))).toBe(false);
    expect(firstReplyPending(state([{ tasks: [] }], [{ usage: { turns: 2 } }]))).toBe(false);
  });
});
