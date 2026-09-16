import { describe, expect, it, vi } from "vitest";

import { startAutoVmClaim, type AutoVmClaimSlot, type AutoVmClaimTable } from "./auto-vm-claims.ts";

const slot = (claim: () => Promise<void>, generation = "gen-1"): AutoVmClaimSlot => ({
  owner: { threadId: "t1", generation },
  claim,
});

describe("startAutoVmClaim", () => {
  it("fires a thread's claim exactly once, even across repeated gate polls", async () => {
    const table: AutoVmClaimTable = new Map();
    const claim = vi.fn(async () => undefined);
    table.set("t1", slot(claim));
    startAutoVmClaim(table, "t1", "gen-1");
    startAutoVmClaim(table, "t1", "gen-1");
    startAutoVmClaim(table, "t1", "gen-1");
    await table.get("t1")!.begin;
    expect(claim).toHaveBeenCalledExactlyOnceWith();
  });

  it("refuses to fire for a different dispatch generation", () => {
    const table: AutoVmClaimTable = new Map();
    const claim = vi.fn(async () => undefined);
    table.set("t1", slot(claim, "gen-1"));
    startAutoVmClaim(table, "t1", "gen-2");
    expect(claim).not.toHaveBeenCalled();
    expect(table.get("t1")!.begin).toBeUndefined();
  });

  it("fails closed: a rejected claim clears the slot and cannot re-fire", async () => {
    const table: AutoVmClaimTable = new Map();
    const claim = vi.fn(async () => { throw new Error("vm not ready"); });
    table.set("t1", slot(claim));
    startAutoVmClaim(table, "t1", "gen-1");
    await table.get("t1")!.begin;
    expect(table.has("t1")).toBe(false);
    startAutoVmClaim(table, "t1", "gen-1");
    expect(claim).toHaveBeenCalledExactlyOnceWith();
  });

  it("keeps the slot after success so later polls stay no-ops", async () => {
    const table: AutoVmClaimTable = new Map();
    const claim = vi.fn(async () => undefined);
    table.set("t1", slot(claim));
    startAutoVmClaim(table, "t1", "gen-1");
    await table.get("t1")!.begin;
    startAutoVmClaim(table, "t1", "gen-1");
    await Promise.resolve();
    expect(claim).toHaveBeenCalledExactlyOnceWith();
    expect(table.has("t1")).toBe(true);
  });

  it("a stale rejection cannot delete a newer generation's slot", async () => {
    const table: AutoVmClaimTable = new Map();
    let rejectFirst: (error: Error) => void = () => {};
    const first = slot(() => new Promise<void>((_, reject) => { rejectFirst = reject; }));
    table.set("t1", first);
    startAutoVmClaim(table, "t1", "gen-1");
    const second = slot(vi.fn(async () => undefined), "gen-2");
    table.set("t1", second);
    rejectFirst(new Error("stale holder"));
    await first.begin;
    expect(table.get("t1")).toBe(second);
    expect(second.begin).toBeUndefined();
  });
});
