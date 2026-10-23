// OpenCode's own builds, for installing it without Node.js: the version `npm install -g opencode-ai` gives (latest on
// npm, 2026-10-24), from https://github.com/anomalyco/opencode/releases/tag/v1.19.4.
// Anomaly publishes no checksum file. Each SHA-256 below was measured on 2026-10-24 by downloading the asset once and
// running `shasum -a 256` on it, and equals the `digest` GitHub reports for that asset
// (`gh api repos/anomalyco/opencode/releases/tags/v1.19.4`); each size is the byte count both agree on.
// Every archive holds a single file at its root, the executable. x64 takes the "baseline" builds, which need no AVX2
// (older Intel CPUs, Rosetta); a Linux without glibc takes the musl builds. Both macOS executables are signed with
// Anomaly Innovations' Developer ID, Team 5NZ4Q7NXJ4 (checked with codesign).
import type { StandaloneRelease } from "../../contracts.ts";

const VERSION = "1.19.4";
const RELEASE = `https://github.com/anomalyco/opencode/releases/download/v${VERSION}`;

export const OPENCODE_STANDALONE: StandaloneRelease = {
  name: "OpenCode",
  engine: "opencode",
  version: VERSION,
  // github.com answers with a redirect to GitHub's release-asset host.
  hosts: ["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"],
  macTeamId: "5NZ4Q7NXJ4",
  // The app installs its own copy's updates; OpenCode's self-updater would replace that copy behind its back.
  runEnv: { OPENCODE_DISABLE_AUTOUPDATE: "1" },
  assets: {
    "darwin-arm64": { url: `${RELEASE}/opencode-darwin-arm64.zip`, archive: "zip", executable: "opencode", approxBytes: 64_291_659, sha256: "c400a2f8c8ab7e99478a7f4dd1a466b57bf33888e520d85c55780a5464c4b689" },
    "darwin-x64": { url: `${RELEASE}/opencode-darwin-x64-baseline.zip`, archive: "zip", executable: "opencode", approxBytes: 69_113_303, sha256: "7ad6170131ed5b8dab9ebd82f5ad5581d0051f8d50754f88460515ad61e1f37e" },
    "linux-x64": { url: `${RELEASE}/opencode-linux-x64-baseline.tar.gz`, archive: "tar.gz", executable: "opencode", approxBytes: 79_667_571, sha256: "1697ef40558d378bd2f72efa8fafe1bed1f0e664f09247b9357556b95dbc7cbc" },
    "linux-arm64": { url: `${RELEASE}/opencode-linux-arm64.tar.gz`, archive: "tar.gz", executable: "opencode", approxBytes: 78_526_339, sha256: "8568230ccd847dc93e95b9f6894379077d3e014a16b48040743573e77c23e85f" },
    "linux-x64-musl": { url: `${RELEASE}/opencode-linux-x64-baseline-musl.tar.gz`, archive: "tar.gz", executable: "opencode", approxBytes: 79_693_320, sha256: "592fcff7847fab2eecda4b5357f66032ea2b413b9e93ce92dab03ee7b40a722c" },
    "linux-arm64-musl": { url: `${RELEASE}/opencode-linux-arm64-musl.tar.gz`, archive: "tar.gz", executable: "opencode", approxBytes: 78_269_653, sha256: "aa32a91f62cfddfa4615ba4deffc2b13696e77cbee83551824e3f16e6770b37e" },
    "win32-x64": { url: `${RELEASE}/opencode-windows-x64-baseline.zip`, archive: "zip", executable: "opencode.exe", approxBytes: 81_744_966, sha256: "21cac96abb146b0f6e770680ea7855fc4f354c7966aab39f5be9859b0df1deac" },
    "win32-arm64": { url: `${RELEASE}/opencode-windows-arm64.zip`, archive: "zip", executable: "opencode.exe", approxBytes: 75_791_921, sha256: "36e696fd1d275b469ab02a1ccc00d161bfdcc0a4ffa93c2b7a4e57399f3ff347" },
  },
};
