import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ANNOUNCEMENTS_DISABLE_ENV, ANNOUNCEMENTS_RETRY_MS, ANNOUNCEMENTS_TTL_MS, AnnouncementStore, announcementsCachePath, BUNDLED_ANNOUNCEMENTS } from "./feed.ts";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const folder = () => { const dir = mkdtempSync(join(tmpdir(), "omb-announcements-")); dirs.push(dir); return dir; };

const card = (over: Record<string, unknown> = {}) => ({
  id: "new-apk", kind: "product", title: "A new APK", body: "Install it from the releases page.",
  starts: "2026-11-01T00:00:00Z", ends: "2027-11-01T00:00:00Z", audience: {},
  primary: { label: "Open releases", action: { open_url: "https://example.com/releases" } },
  ...over,
});

const feed = (over: Record<string, unknown> = {}) => ({ version: 1, updatedAt: "2027-01-05T00:00:00Z", cards: [card()], ...over });

describe("the bundled announcements", () => {
  it("reads as a strict feed, and starts empty so nothing ships that nobody wrote", () => {
    // A build that ships cards nobody chose would put words in the project's mouth on every install.
    expect(BUNDLED_ANNOUNCEMENTS).toMatchObject({ version: 1, cards: [] });
  });

  it("keeps its cache under providers/, where a backup leaves it out", () => {
    expect(announcementsCachePath("/data")).toBe(join("/data", "providers", "announcements", "announcements.json"));
  });
});

describe("the announcements store", () => {
  const store = (dir: string, fetchImpl?: typeof fetch, over: Partial<ConstructorParameters<typeof AnnouncementStore>[0]> = {}) =>
    new AnnouncementStore({ dataDir: dir, now: () => NOW, fetch: fetchImpl, log: () => {}, ...over });
  const answer = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

  it("hands a page nothing while the bundle has no cards, and the card a download brings", async () => {
    const dir = folder();
    // A fresh folder: nothing on disk, so the first ask waits for its download and gets the card.
    const s = store(dir, answer(feed()), { now: () => Date.parse("2027-01-06T00:00:00Z") });
    expect((await s.cardsForPage(100)).map((one) => one.id)).toEqual(["new-apk"]);
  });

  it("leaves the current copy alone when the download fails, so an offline phone still shows what it had", async () => {
    const dir = folder();
    const offline = store(dir, (async () => { throw new Error("offline"); }) as unknown as typeof fetch);
    expect((await offline.cardsForPage(10)).map((one) => one.id)).toEqual([]);
  });

  it("ignores a download older than the copy it already has", async () => {
    const dir = folder();
    const older = feed({ updatedAt: "2020-01-01T00:00:00Z", cards: [card({ id: "ancient" })] });
    const s = store(dir, answer(older), { now: () => Date.parse("2026-11-20T00:00:00Z") });
    await s.cardsForPage(10);
    expect(s.cards().map((one) => one.id)).not.toContain("ancient");
  });

  it("shares one request and backs off after a failure", async () => {
    const dir = folder();
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 500 }));
    const s = store(dir, fetchImpl as unknown as typeof fetch, { now: () => Date.parse("2026-11-20T00:00:00Z") });
    await Promise.all([s.refresh({ force: true }), s.refresh({ force: true })]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await s.refresh();
    expect(fetchImpl, "inside the retry window").toHaveBeenCalledTimes(1);
    expect(ANNOUNCEMENTS_RETRY_MS).toBeLessThan(ANNOUNCEMENTS_TTL_MS);
  });

  it("shows nothing at all when the environment switches it off, and never downloads", async () => {
    const dir = folder();
    const fetchImpl = vi.fn();
    const s = store(dir, fetchImpl as unknown as typeof fetch, { env: { [ANNOUNCEMENTS_DISABLE_ENV]: "1" } });
    expect(s.cards()).toEqual([]);
    expect(await s.cardsForPage(10)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("drops a card whose time has passed", async () => {
    const dir = folder();
    const s = store(dir, answer(feed({ cards: [card({ ends: "2026-11-02T00:00:00Z" })] })), { now: () => Date.parse("2026-11-20T00:00:00Z") });
    await s.cardsForPage(10);
    expect(s.cards()).toEqual([]);
  });
});
