// Android (the phone lane) mounts a local computer only when a bot explicitly picks
// "this computer"; never automatically.
const HOSTS_WITH_LOCAL_CONTROL = new Set<NodeJS.Platform>(["darwin", "win32", "linux", "android"]);
const HOSTS_WITH_AUTO_LOCAL = new Set<NodeJS.Platform>(["darwin", "win32"]);

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
