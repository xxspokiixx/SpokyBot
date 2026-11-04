/** The bridge the phone shell injects into the WebView as `window.ombAndroidCaps`
 * (android-test/app/src/main/kotlin/.../MainActivity.kt). It is the only native
 * surface available on the phone: everything else keeps its plain-browser path.
 *
 * The shell and this UI ship together inside the APK, so adding a method here
 * requires the matching `@JavascriptInterface` in the shell before the next
 * staging; a missing method falls back to the browser behaviour. */
export interface AndroidBridge {
  capabilitiesJson(): string;
  buildVersion(): string;
  notify(title: string, body: string, silent: boolean): void;
  openExternal(url: string): void;
  download(url: string, filename: string, mimeType: string): void;
  downloadBase64(filename: string, mimeType: string, base64: string): void;
  saveBackup(url: string, filename: string): void;
}

export function androidBridge(): AndroidBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as Window & { ombAndroidCaps?: Partial<AndroidBridge> }).ombAndroidCaps;
  return bridge?.capabilitiesJson ? (bridge as AndroidBridge) : null;
}
