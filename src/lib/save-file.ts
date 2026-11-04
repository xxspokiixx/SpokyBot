import { androidBridge } from "./android-bridge";

/** True on the phone shell, before awaiting anything: call sites keep their
 * synchronous browser anchor flow when this is false. */
export function androidSaveAvailable(): boolean {
  return androidBridge() !== null;
}

/**
 * Save to this device through the phone shell's bridge; returns false when the
 * bridge is absent so the caller keeps its browser anchor flow. A plain WebView
 * needs this: blob: URLs never reach a DownloadListener, and its loopback
 * server URLs would hand the system browser an address that only exists on the
 * phone. The shell writes the bytes (or fetches the URL natively, with the
 * session cookie) and shows the system save dialog.
 */
export async function tryAndroidSave(source: Blob | string, filename: string, mimeType?: string): Promise<boolean> {
  const bridge = androidBridge();
  if (!bridge) return false;
  if (typeof source === "string") {
    const url = new URL(source, window.location.href);
    if (url.protocol === "http:" || url.protocol === "https:") {
      bridge.download(url.href, filename, mimeType ?? "application/octet-stream");
      return true;
    }
    // blob:/data: URLs cannot be fetched by the shell; read them back into memory.
    source = await (await fetch(url)).blob();
  }
  // A Blob's type is "" when the page never set one, which ?? would hand to the shell.
  bridge.downloadBase64(filename, mimeType?.trim() || source.type?.trim() || "application/octet-stream", await blobToBase64(source));
  return true;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}
