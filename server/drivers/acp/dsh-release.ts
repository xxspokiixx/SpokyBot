// DeepSeek Harness's own build, downloaded when a person picks DeepSeek rather than carried in the APK.
//
// `@deepseek-ai/dsh` on npm is a Node application, and the phone ships no npm. DeepSeek publishes the
// same CLI as a native executable for Linux arm64 inside a Python SDK wheel
// (deepseek-harness-runtime-bin), which is a plain zip: the executable is unpacked from it like any
// other archive. The wheel is the release; its `-rg` sidecar stays beside the program and is bound in
// with it, because dsh ships ripgrep for its own search.
//
// Hashes measured on 2026-11-20 from the wheel PyPI serves for manylinux_2_28_aarch64
// (deepseek-harness-runtime-bin 0.1.5rc1): the archive SHA-256 by downloading it, the program
// SHA-256 by hashing the unpacked file. The program reports its own version as `0.1.5-rc.1`.
import type { StandaloneRelease } from "../../contracts.ts";

const WHEEL = "deepseek_harness_runtime_bin-0.1.5rc1-py3-none-manylinux_2_28_aarch64.whl";
const RELEASE = `https://files.pythonhosted.org/packages/b0/33/9bb2ad17dc0a48d3641c7dd0bfdb8742333577739b31c70f46356847706a`;

export const DSH_STANDALONE: StandaloneRelease = {
  name: "DeepSeek Harness",
  engine: "dsh",
  // What `dsh --version` prints, which the probe compares against.
  version: "0.1.5-rc.1",
  hosts: ["files.pythonhosted.org"],
  // dsh keeps its profiles under DSH_HOME and refuses to boot without one.
  runEnv: { DSH_HOME: "" },
  previousPrograms: {},
  assets: {
    "linux-arm64": {
      url: `${RELEASE}/${WHEEL}`,
      archive: "zip",
      executable: "deepseek_harness_runtime/runtime/deepseek-harness-sdk-runtime-linux-arm64",
      command: "dsh",
      approxBytes: 80_243_585,
      sha256: "32b7bb7887ea89f12462274d1b21acfafb00d38d94e11a5d7122492f185e4f85",
      executableSha256: "8cc6cb454ec1737858efe12844915edd18911a6cae5e778569a6de85918fb9da",
    },
  },
};
