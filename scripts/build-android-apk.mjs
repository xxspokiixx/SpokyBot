// Build Android APK. The version comes from scripts/android-version.mjs, the same module CI uses:
// the commit count, scaled above every published release, so an update always installs over the last.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { androidVersion, commitCount } from "./android-version.mjs";

const __dirname = join(fileURLToPath(import.meta.url), "..");
const ROOT = join(__dirname, "..");
const ANDROID_DIR = join(ROOT, "android-test");
const APP_BUILD_GRADLE = join(ANDROID_DIR, "app", "build.gradle.kts");
const PACKAGE_JSON = join(ROOT, "package.json");

function run(cmd, cwd = ROOT) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { cwd, encoding: "utf8", stdio: "inherit" });
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
  const { versionCode, versionName } = androidVersion(commitCount(ROOT));

  console.log(`Version Name: ${versionName}`);
  console.log(`Version Code: ${versionCode}\n`);

  // Step 2: Update build.gradle.kts
  updateVersion(versionCode, versionName);

  // Step 2b: Update package.json for UI display
  updatePackageJsonVersion(versionName);

  // Step 3: Rebuild the server bundle now that package.json carries this build's
  // version. The bundle copies that version into dist-server/package.json and
  // the server reports it, so a stale bundle ships an APK whose own About page
  // and doctor line name a different build.
  console.log("\n=== Bundling server ===");
  run("node scripts/bundle-server.mjs");

  // Step 4: Run prepare-android-assets.mjs (stages server, UI, engine, skills)
  console.log("\n=== Preparing Android assets ===");
  run("node prepare-android-assets.mjs", ANDROID_DIR);

  // Step 5: Build APK using Gradle
  console.log("\n=== Building APK ===");
  // `sh gradlew` on POSIX runners: git on Windows records no exec bit for the
  // wrapper script, so a direct ./gradlew would fail with permission denied.
  // On Windows the wrapper is run by its absolute path, never through `cmd /c`:
  // a child process's current-directory search does not find the wrapper, and cmd
  // then answers "'gradlew.bat' is not recognized".
  const gradlew =
    process.platform === "win32" ? JSON.stringify(join(ANDROID_DIR, "gradlew.bat")) : "sh gradlew";
  run(`${gradlew} :app:assembleDebug`, ANDROID_DIR);

  // Step 6: Show output location
  const apkPath = join(ANDROID_DIR, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
  console.log(`\n=== APK built at: ${apkPath} ===`);
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});