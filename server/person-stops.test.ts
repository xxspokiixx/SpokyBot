import { describe, expect, it } from "vitest";

import { PERSON_STOPPED_TURN_NAME, STOPPED_TURN_NAME } from "../shared/client-cancel.ts";
import { PersonStops, stopReachesLiveTurn, stoppedTurnRow } from "./person-stops.ts";
import type { Message } from "./store.ts";

const row = (fields: Partial<Message>): Message => ({ id: `m-${Math.random()}`, at: 1, role: "bot", kind: "activity", ...fields }) as Message;

describe("PersonStops", () => {
  it("knows the turn the person stopped, and only that one", () => {
    const stops = new PersonStops();
    stops.stop("t1", "turn-1");
    expect(stops.stopped("t1", "turn-1")).toBe(true);
    expect(stops.stopped("t1", "turn-2")).toBe(false);
    expect(stops.stopped("t2", "turn-1")).toBe(false);
    stops.forget("t1");
    expect(stops.stopped("t1", "turn-1")).toBe(false);
  });

  it("takes a Stop pressed while the turn was still being dispatched for whatever that turn turns out to be", () => {
    const stops = new PersonStops();
    stops.stop("t1", undefined);
    expect(stops.stopped("t1", "turn-1")).toBe(true);
  });
});

describe("stopReachesLiveTurn", () => {
  it("lets a Stop that names the live turn through", () => {
    expect(stopReachesLiveTurn("turn-1", "turn-1")).toBe(true);
  });

  it("stops nothing when the named turn is over, or the next one is running", () => {
    expect(stopReachesLiveTurn("turn-1", undefined)).toBe(false);
    expect(stopReachesLiveTurn("turn-1", "turn-2")).toBe(false);
  });

  it("keeps an older client's Stop, which names no turn, reaching whatever runs", () => {
    expect(stopReachesLiveTurn(undefined, "turn-2")).toBe(true);
  });
});

describe("stoppedTurnRow", () => {
  it("says the person stopped it when they did, and Stopped otherwise", () => {
    expect(stoppedTurnRow([], "turn-1", true)).toEqual({ role: "bot", kind: "activity", tool: { name: PERSON_STOPPED_TURN_NAME, ok: true }, turnId: "turn-1" });
    expect(stoppedTurnRow([], "turn-1", false)?.tool?.name).toBe(STOPPED_TURN_NAME);
    expect(PERSON_STOPPED_TURN_NAME).toBe("stopped: You stopped this.");
  });

  it("gives a turn one stopped row, even with rows after it", () => {
    const messages = [
      row({ role: "user", kind: "text", text: "go" }),
      row({ turnId: "turn-1", tool: { name: PERSON_STOPPED_TURN_NAME, ok: true } }),
      row({ turnId: "turn-1", tool: { name: "notice: OpenCode answered after a slow start.", ok: true } }),
    ];
    expect(stoppedTurnRow(messages, "turn-1", true)).toBeNull();
    expect(stoppedTurnRow(messages, "turn-2", true)).not.toBeNull();
  });

  it("never counts an earlier request's stop", () => {
    const messages = [
      row({ turnId: "turn-1", tool: { name: STOPPED_TURN_NAME, ok: true } }),
      row({ role: "user", kind: "text", text: "again" }),
    ];
    expect(stoppedTurnRow(messages, "turn-1", false)).not.toBeNull();
  });
});
