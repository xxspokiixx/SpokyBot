const HOSTS_WITH_LOCAL_CONTROL = new Set<NodeJS.Platform>(["darwin", "win32", "linux", "android"]);
const HOSTS_WITH_AUTO_LOCAL = new Set<NodeJS.Platform>(["darwin", "win32"]);
const HOSTS_WITH_CONTAINERS = new Set<NodeJS.Platform>(["darwin", "win32", "linux"]);

/** A Local VM needs a container runtime, which the phone shell never has: its "this computer"
 * is the proot'ed rootfs, and offering a private desktop there can only fail. */
export function localVmOffered(hostPlatform: NodeJS.Platform = process.platform): boolean {
  return HOSTS_WITH_CONTAINERS.has(hostPlatform);
}

export function shouldMountLocalComputer({
  requested,
  hostPlatform = process.platform,
  providerSupportsLocal,
}: {
  requested: "cloud" | "local" | "off" | undefined;
  hostPlatform?: NodeJS.Platform;
  providerSupportsLocal: boolean;
}): boolean {
  if (!providerSupportsLocal) return false;
  if (requested === "local") return HOSTS_WITH_LOCAL_CONTROL.has(hostPlatform);
  return requested === undefined && HOSTS_WITH_AUTO_LOCAL.has(hostPlatform);
}
