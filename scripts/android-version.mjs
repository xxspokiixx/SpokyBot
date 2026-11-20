// The Android build number, derived so it only ever grows.
//
// Android refuses to install an APK whose versionCode is not greater than the installed one, and the
// old scheme took its number from the pull request (0.<PR>.<commits>). This fork's PRs number in the
// single digits while the upstream releases it inherited numbered in the thousands, so every build
// here produced a smaller code than the one already on the phone: 4001 against a published 4131082,
// and the update could not install at all.
//
// The commit count is the one number that cannot go backwards. It is multiplied so the result starts
// above everything already published, and the highest code any release has used is asserted as a
// floor, so a formula that ever drifts below it fails the build instead of shipping an APK nobody
// can install over the last one.
import { execFileSync } from "node:child_process";

/** 2,100,000,000 is the largest versionCode Google Play accepts. */
export const MAX_VERSION_CODE = 2_100_000_000;

/** The highest code any release has published (0.4131.82). A build below it cannot install over it. */
export const PUBLISHED_FLOOR = 4_131_082;

/** Leaves room above the inherited numbering while growing once per commit. */
const SCALE = 1_000;

/** The count of commits reachable from `ref`, which is what makes the code grow on every release. */
export function commitCount(root, ref = "HEAD") {
  const out = execFileSync("git", ["rev-list", "--count", ref], { cwd: root, encoding: "utf8" }).trim();
  const count = Number.parseInt(out, 10);
  if (!Number.isFinite(count) || count <= 0) throw new Error(`could not count commits in ${root}`);
  return count;
}

/** `versionCode` above every published release, and `versionName` that sorts above them too.
 *  Throws rather than emit a code Android would refuse or Play would reject. */
export function androidVersion(count, floor = PUBLISHED_FLOOR) {
  if (!Number.isInteger(count) || count <= 0) throw new Error(`a version needs a positive commit count, got ${count}`);
  const versionCode = count * SCALE;
  if (versionCode <= floor) {
    throw new Error(
      `commit count ${count} yields versionCode ${versionCode}, not above the published ${floor}: raise SCALE so the update can install`,
    );
  }
  if (versionCode > MAX_VERSION_CODE) throw new Error(`versionCode ${versionCode} exceeds the largest Play accepts`);
  return { versionCode, versionName: `0.${count}` };
}
