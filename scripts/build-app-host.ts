// Bundles the phones' app host page: shared/app-frame/host-page.ts and the
// bridge router into one static file, shared/app-frame/app-host.html
// (docs/superpowers/specs/2026-10-14-chat-apps-design.md, "Phone host page").
// The file is committed. Its first line is a comment with the sha256 of
// everything after that line; scripts/gen-app-fixtures.ts copies the file
// into the mobile repo, and the phone tests fail when the hash differs from
// the fixture's. shared/app-frame/app-host.test.ts fails when the committed
// file is not what this script builds.
//
//   node --experimental-strip-types scripts/build-app-host.ts           write it
//   node --experimental-strip-types scripts/build-app-host.ts --check   exit 1 if stale
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const FRAME_DIR = fileURLToPath(new URL("../shared/app-frame/", import.meta.url));
export const APP_HOST_HTML = `${FRAME_DIR}app-host.html`;

/** The page around the script: no CSP of its own (a srcdoc frame inherits
 * its parent's policy, and the app's own meta is the one that limits it),
 * a transparent background, the frame as wide as the web view. */
function page(script: string): string {
  return [
    "<!DOCTYPE html>",
    "<html lang=\"en\"><head><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no\">",
    "<meta name=\"color-scheme\" content=\"light dark\"><title>App</title>",
    "<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}iframe{display:block;width:100%;border:0;background:transparent}</style>",
    "</head><body>",
    `<script id="mausbot-app-host">${script}</script>`,
    "</body></html>",
    "",
  ].join("\n");
}

export function appHostHash(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

/** The first line's hash, or null when the file has none. */
export function appHostHashOf(html: string): string | null {
  return /^<!-- mausbot app-host v1 sha256:([0-9a-f]{64}) -->\n/.exec(html)?.[1] ?? null;
}

export async function buildAppHostHtml(): Promise<string> {
  const result = await build({
    stdin: { contents: "import { bootAppHostPage } from \"./host-page.ts\";\nbootAppHostPage();\n", resolveDir: FRAME_DIR, sourcefile: "app-host-entry.ts", loader: "ts" },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    // iOS 16 Safari and any Android System WebView of the last few years.
    target: ["safari16", "chrome100"],
    minify: true,
    legalComments: "none",
    charset: "utf8",
  });
  const script = result.outputFiles[0]!.text.trim();
  if (/<\/script/i.test(script) || /<!--/.test(script)) throw new Error("the app host bundle holds text that would end its script element");
  const body = page(script);
  return `<!-- mausbot app-host v1 sha256:${appHostHash(body)} -->\n${body}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = await buildAppHostHtml();
  if (process.argv.includes("--check")) {
    let current = "";
    try { current = readFileSync(APP_HOST_HTML, "utf8"); } catch { /* missing is stale */ }
    if (current !== html) {
      console.error("shared/app-frame/app-host.html is stale: run node --experimental-strip-types scripts/build-app-host.ts");
      process.exit(1);
    }
    console.log(`app-host.html is current (sha256 ${appHostHashOf(html)})`);
  } else {
    writeFileSync(APP_HOST_HTML, html);
    console.log(`wrote shared/app-frame/app-host.html (${html.length} bytes, sha256 ${appHostHashOf(html)})`);
  }
}
