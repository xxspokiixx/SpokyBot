import { describe, expect, it } from "vitest";

import { botThreadsHost, defaultBotThreads, MAX_CONCURRENT_BOT_THREADS, maxConcurrentBotThreadsFor } from "./bot-thread-limits.ts";

const GB = 1024 ** 3;
const host = (gb: number, memoryGate = false) => ({ memoryGate, totalBytes: gb * GB, oneThreadPerBot: false });

describe("how many threads one bot runs", () => {
  it("follows the machine: two on a 3.8 GB phone, three on an 8 GB box, and the ceiling above 32 GB", () => {
    expect(defaultBotThreads(host(3.8))).toBe(2);
    expect(defaultBotThreads(host(8))).toBe(4);
    expect(defaultBotThreads(host(40))).toBe(MAX_CONCURRENT_BOT_THREADS);
  });

  it("never goes below the floor, whatever the machine reports", () => {
    expect(defaultBotThreads(host(0.5))).toBe(2);
    expect(defaultBotThreads({ memoryGate: false, totalBytes: 0 })).toBe(2);
  });

  it("leaves the ceiling to the memory gate where it runs", () => {
    // The gate already holds a turn until an engine fits, so a low number here would be a second, blinder limit.
    expect(defaultBotThreads(host(3.8, true))).toBe(MAX_CONCURRENT_BOT_THREADS);
  });

  it("takes a saved number over the default, and a plan's one-thread limit over both", () => {
    expect(maxConcurrentBotThreadsFor({ threads: { maxConcurrentPerBot: 1 } }, host(3.8))).toBe(1);
    expect(maxConcurrentBotThreadsFor({ threads: { maxConcurrentPerBot: 6 } }, host(3.8))).toBe(6);
    expect(maxConcurrentBotThreadsFor({}, host(3.8))).toBe(2);
    expect(maxConcurrentBotThreadsFor({}, { ...host(32), oneThreadPerBot: true })).toBe(1);
  });

  it("reads the machine's memory when no host is given", () => {
    expect(botThreadsHost().totalBytes).toBeGreaterThan(0);
    expect(maxConcurrentBotThreadsFor({})).toBeGreaterThanOrEqual(2);
  });
});
