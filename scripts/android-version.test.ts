// The build number must rise for every release, or Android refuses the install: this is the bug
// that made the phone reject an update over 4131082 while the fork's PRs numbered in single digits.
import { describe, expect, it } from "vitest";

import { androidVersion, commitCount, MAX_VERSION_CODE, PUBLISHED_FLOOR, PUBLISHED_VERSION } from "./android-version.mjs";

describe("the Android build number", () => {
  it("starts above every release already published", () => {
    // The code the phone has installed; a smaller one cannot replace it.
    const v = androidVersion(commitCount(process.cwd()));
    expect(v.versionCode).toBeGreaterThan(PUBLISHED_FLOOR);
  });

  it("grows with each commit, so the next release is always an upgrade", () => {
    const now = androidVersion(7_670);
    const later = androidVersion(7_671);
    expect(later.versionCode).toBeGreaterThan(now.versionCode);
    // The name grows too, so a person comparing two builds sees the newer one.
    expect(Number(later.versionName.split(".")[1])).toBeGreaterThan(Number(now.versionName.split(".")[1]));
  });

  it("carries the commit count in the name, so a build can be traced to its source", () => {
    expect(androidVersion(12_345)).toEqual({ versionCode: 12_345_000, versionName: "0.12345.0" });
  });

  it("names a build in three parts, because the same name lands in package.json", () => {
    // electron-builder refuses a two-part version, so an Android stamp that wrote "0.7672" broke the
    // desktop package lane: every part must be present.
    const { versionName } = androidVersion(7_672);
    expect(versionName).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("names a build above the last published release, so an update reads as newer", () => {
    const [major, minor, patch] = androidVersion(commitCount(process.cwd())).versionName.split(".").map(Number);
    const [publishedMajor, publishedMinor, publishedPatch] = PUBLISHED_VERSION.split(".").map(Number);
    const older = (a: number[], b: number[]) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
    expect(older([major!, minor!, patch!], [publishedMajor!, publishedMinor!, publishedPatch!])).toBeGreaterThan(0);
  });

  it("refuses a count that would ship an uninstallable APK", () => {
    // A number at or below the published floor is the exact failure that started this.
    expect(() => androidVersion(Math.floor(PUBLISHED_FLOOR / 1000) - 1)).toThrow(/not above the published/);
  });

  it("refuses a code beyond what Play accepts", () => {
    expect(() => androidVersion(MAX_VERSION_CODE + 1)).toThrow(/exceeds the largest/);
  });

  it("refuses a count that is not a positive integer", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => androidVersion(bad), String(bad)).toThrow(/positive commit count/);
    }
  });
});
