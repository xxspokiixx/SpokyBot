// Build Android APK with versioning: 0.PR_NUMBER.COMMIT_NUMBER
// PR number from latest merged PR, commit number = commits since that PR merge

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = join(fileURLToPath(import.meta.url), "..");
const ROOT = join(__dirname, "..");
const ANDROID_DIR = join(ROOT, "android-test");
const APP_BUILD_GRADLE = join(ANDROID_DIR, "app", "build.gradle.kts");
const PACKAGE_JSON = join(ROOT, "package.json");

function run(cmd, cwd = ROOT) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { cwd, encoding: "utf8", stdio: "inherit" });
}

function runCapture(cmd, cwd = ROOT) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { cwd, encoding: "utf8" }).trim();
}

// Get latest merged PR number from git log
function getLatestMergedPR() {
  // Look for "Merge pull request #XXX" in recent commits
  const log = runCapture('git log --oneline -50 --grep="Merge pull request"', ROOT);
  const match = log.match(/Merge pull request #(\d+)/);
  if (match) return parseInt(match[1], 10);
  // Fallback: check the latest commit message if it's a merge
  const latestMsg = runCapture("git log -1 --pretty=%B", ROOT);
  const fallbackMatch = latestMsg.match(/Merge pull request #(\d+)/);
  if (fallbackMatch) return parseInt(fallbackMatch[1], 10);
  return 0; // unknown
}

// Get commit count since the latest PR merge
function getCommitsSinceLastPR(prNumber) {
  // Find the commit hash of the PR merge
  const mergeCommit = runCapture(`git log --oneline --grep="Merge pull request #${prNumber}" -1 --pretty=%H`, ROOT);
  if (!mergeCommit) return 1;
  // Count commits since that merge (excluding the merge itself)
  const count = runCapture(`git rev-list ${mergeCommit}..HEAD --count`, ROOT);
  return parseInt(count, 10) || 1;
}

// Update version in build.gradle.kts
function updateVersion(versionCode, versionName) {
  let content = readFileSync(APP_BUILD_GRADLE, "utf8");
  content = content.replace(/versionCode\s*=\s*\d+/, `versionCode = ${versionCode}`);
  content = content.replace(/versionName\s*=\s*"[^"]+"/, `versionName = "${versionName}"`);
  writeFileSync(APP_BUILD_GRADLE, content);
  console.log(`Updated version: versionCode=${versionCode}, versionName=${versionName}`);
}

// Update version in package.json for UI display
function updatePackageJsonVersion(versionName) {
  const content = readFileSync(PACKAGE_JSON, "utf8");
  const updated = content.replace(/"version"\s*:\s*"[^"]+"/, `"version": "${versionName}"`);
  writeFileSync(PACKAGE_JSON, updated);
  console.log(`Updated package.json version: ${versionName}`);
}

async function main() {
  console.log("=== Building Android APK ===\n");

  // Step 1: Determine version
  const prNumber = getLatestMergedPR();
  const commitNumber = getCommitsSinceLastPR(prNumber);
  const versionName = `0.${prNumber}.${commitNumber}`;
  // versionCode must be integer, monotonically increasing. Use PR*1000 + commit
  const versionCode = prNumber * 1000 + commitNumber;

  console.log(`PR Number: ${prNumber}`);
  console.log(`Commit Number (since PR merge): ${commitNumber}`);
  console.log(`Version Name: ${versionName}`);
  console.log(`Version Code: ${versionCode}\n`);

  // Step 2: Update build.gradle.kts
  updateVersion(versionCode, versionName);

  // Step 2b: Update package.json for UI display
  updatePackageJsonVersion(versionName);

  // Step 3: Run prepare-android-assets.mjs (stages server, UI, engine, skills)
  console.log("\n=== Preparing Android assets ===");
  run("node prepare-android-assets.mjs", ANDROID_DIR);

  // Step 4: Build APK using Gradle
  console.log("\n=== Building APK ===");
  const gradlewPath = join(ANDROID_DIR, "gradlew.bat");
  run(`cmd /c "${gradlewPath}" :app:assembleDebug`, ANDROID_DIR);

  // Step 5: Show output location
  const apkPath = join(ANDROID_DIR, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
  console.log(`\n=== APK built at: ${apkPath} ===`);
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});