import { androidBridge } from "./android-bridge";

function androidCapabilities(): DesktopCapabilities | null {
  const bridge = androidBridge();
  if (!bridge) return null;
  try {
    return JSON.parse(bridge.capabilitiesJson()) as DesktopCapabilities;
  } catch {
    return null;
  }
}

const browserCapabilities: DesktopCapabilities = {
  host: {
    platform: "other",
    label: "Browser",
    session: "unknown",
    packaged: false,
  },
  windowChrome: "native",
  screenPreview: {
    available: false,
    interaction: "none",
    reasonCode: "desktop-app-required",
  },
  dictation: {
    available: false,
    engine: "none",
    onDevice: false,
    reasonCode: "desktop-app-required",
  },
  localComputer: {
    available: false,
    support: "unsupported",
    enabled: false,
    status: "unavailable",
    reasonCode: "desktop-app-required",
  },
};

let cached: DesktopCapabilities | null = null;
let cacheRevision = 0;

export function initialDesktopCapabilities(): DesktopCapabilities {
  const android = androidCapabilities();
  if (android) return android;
  const platform = typeof window === "undefined" ? undefined : window.ogb?.platform;
  if (!platform) return browserCapabilities;
  const isMac = platform === "darwin";
  const dictation: DesktopCapabilities["dictation"] = {
    available: isMac,
    engine: isMac ? "apple-speech" : "none",
    onDevice: isMac,
  };
  if (!isMac) dictation.reasonCode = "unsupported-platform";
  return {
    ...browserCapabilities,
    host: {
      ...browserCapabilities.host,
      platform: platform === "darwin" || platform === "linux" || platform === "win32" || platform === "android" ? platform : "other",
      label: platform === "darwin" ? "macOS" : platform === "linux" ? "Linux" : platform === "win32" ? "Windows" : platform === "android" ? "Android" : "Desktop",
    },
    windowChrome: isMac ? "mac-inset" : platform === "win32" ? "win-caption" : "native",
    dictation,
  };
}

export async function loadDesktopCapabilities(): Promise<DesktopCapabilities> {
  if (cached) return cached;
  const android = androidCapabilities();
  if (android) {
    cached = android;
    return cached;
  }
  if (!window.ogb?.getCapabilities) return browserCapabilities;
  const revisionAtStart = cacheRevision;
  let loaded: DesktopCapabilities;
  try {
    loaded = await window.ogb.getCapabilities();
  } catch {
    loaded = browserCapabilities;
  }
  // An IPC push may have delivered newer readiness meanwhile; never let this older response replace it.
  if (cacheRevision !== revisionAtStart && cached) return cached;
  cached = loaded;
  return cached;
}

export function desktopCapabilitiesNow(): DesktopCapabilities {
  return cached ?? initialDesktopCapabilities();
}

export function cacheDesktopCapabilities(capabilities: DesktopCapabilities): DesktopCapabilities {
  cacheRevision += 1;
  cached = capabilities;
  return capabilities;
}
