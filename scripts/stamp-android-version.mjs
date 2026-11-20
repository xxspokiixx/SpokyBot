// Writes the build number into the two files the APK build reads, and prints the release outputs.
// Run by the Android APK workflow and by scripts/build-android-apk.mjs, so a CI build and a local
// build cannot disagree about the version.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { androidVersion, commitCount } from "./android-version.mjs";

const version = androidVersion(commitCount(process.cwd()));

const gradlePath = "android-test/app/build.gradle.kts";
writeFileSync(gradlePath, readFileSync(gradlePath, "utf8")
  .replace(/versionCode\s*=\s*\d+/, `versionCode = ${version.versionCode}`)
  .replace(/versionName\s*=\s*"[^"]+"/, `versionName = "${version.versionName}"`));

const pkgPath = "package.json";
writeFileSync(pkgPath, readFileSync(pkgPath, "utf8")
  .replace(/"version"\s*:\s*"[^"]+"/, `"version": "${version.versionName}"`));

console.log(`versionCode=${version.versionCode} versionName=${version.versionName}`);

// GitHub Actions reads these from $GITHUB_OUTPUT; anywhere else the print above is the record.
const output = process.env.GITHUB_OUTPUT;
if (output) appendFileSync(output, `version=${version.versionName}\ncode=${version.versionCode}\ntag=v${version.versionName}\n`);
