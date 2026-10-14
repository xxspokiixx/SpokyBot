// Chat app frames (docs/superpowers/specs/2026-10-14-chat-apps-design.md,
// "Desktop", security rule 5): a bot's page or an MCP server's UI runs in a
// srcdoc iframe sandboxed with "allow-scripts allow-forms", so its origin is
// opaque. The sandbox already stops it from navigating the window or opening
// one; what it does not stop is the frame navigating itself, which would
// fetch any URL. In will-frame-navigate, a subframe whose origin is opaque
// may only load its own document: about:srcdoc, or about:blank.
//
// Verified on Electron 43.7.9: a frame's self-navigation fires
// will-frame-navigate with frame.origin === "null" and an empty frame.url,
// and preventDefault() stops it before any request leaves.
// scripts/smoke-app-frames.mjs checks that against a real frame.

const OWN_DOCUMENTS = new Set(["about:srcdoc", "about:blank"]);

/**
 * Whether one will-frame-navigate may go ahead, as far as app frames are
 * concerned. Main frames and frames with a real origin are left to the
 * window's other rules.
 *
 * @param {{ isMainFrame?: boolean, url?: string, frame?: { origin?: string } | null } | null | undefined} details
 * @returns {boolean} false when the navigation must be cancelled
 */
export function appFrameNavigationAllowed(details) {
  if (!details || details.isMainFrame) return true;
  // A link to a fragment of the page itself stays inside its own document.
  const url = typeof details.url === "string" ? details.url.split("#")[0] : "";
  if (OWN_DOCUMENTS.has(url)) return true;
  let origin;
  try {
    origin = details.frame?.origin;
  } catch {
    // Reading a frame whose render frame is already gone throws ("Render
    // frame was disposed…"): a frame that navigates again right after one of
    // its navigations was cancelled does exactly that. Thrown here, it would
    // be an uncaught error in the main process. A frame nobody can read is
    // not let through.
    return false;
  }
  return origin !== "null";
}
