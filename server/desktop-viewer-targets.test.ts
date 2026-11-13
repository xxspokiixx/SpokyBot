import { describe, expect, it, vi } from "vitest";

const prootStatus = vi.hoisted(() => vi.fn());
vi.mock("./container-computer.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("./container-computer.ts")>(),
  androidProotStatus: prootStatus,
}));

const { localDesktopTarget } = await import("./desktop-viewer-targets.ts");
const { SHARED_LOCAL_VM_TARGET } = await import("./container-computer.ts");

const running = {
  target_key: "shared",
  viewer_url: "http://localhost:56082/vnc.html",
  viewer_port: 56082,
  managed: true,
  imageMatches: true,
  network: "loopback" as const,
  container: "running" as const,
};
type Status = Awaited<ReturnType<typeof import("./container-computer.ts").androidProotStatus>>;
const stopped: Status = { ...(running as unknown as Status), container: "missing", viewer_port: null, viewer_url: "" };
const deps = {
  status: vi.fn(async (): Promise<Status> => { throw new Error("no container runtime"); }),
  touch: vi.fn(),
};

function androidPlatform() {
  return Object.defineProperty(process, "platform", { value: "android", configurable: true });
}

describe("local desktop target on Android", () => {
  it("serves the phone's proot desktop where no container runtime exists", async () => {
    androidPlatform();
    prootStatus.mockResolvedValue(running);
    const connection = await localDesktopTarget(SHARED_LOCAL_VM_TARGET, deps).resolve();
    expect(connection).toMatchObject({ port: 56082, password: null });
    expect(deps.status).not.toHaveBeenCalled();
  });

  it("refuses while the proot desktop is not running", async () => {
    androidPlatform();
    prootStatus.mockResolvedValue(stopped);
    await expect(localDesktopTarget(SHARED_LOCAL_VM_TARGET, deps).resolve()).rejects.toMatchObject({ status: 409 });
  });

  it("keeps asking the container runtime everywhere else", async () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    deps.status.mockClear();
    prootStatus.mockClear();
    deps.status.mockResolvedValue(running as unknown as Status);
    await expect(localDesktopTarget(SHARED_LOCAL_VM_TARGET, deps).resolve()).resolves.toMatchObject({ port: 56082 });
    expect(prootStatus).not.toHaveBeenCalled();
  });
});
