// The Content-Security-Policy of an app frame (docs/superpowers/specs/
// 2026-10-14-chat-apps-design.md, "CSP for bot HTML" and "CSP for MCP apps").
// The server builds it once and puts it first in the frame's srcdoc
// (document.ts); phones repeat it at the network layer from `network`.
//
// Two policies:
// - Bot HTML: exact and fixed. Three package CDNs (and Google Fonts for
//   styles and fonts), none of which shows a requester's URLs to a third
//   party; no images from arbitrary hosts, so no tracking pixels.
// - MCP apps: the spec's construction from the UI resource's
//   `_meta.ui.csp.resourceDomains` (R) and `connectDomains` (C), after the
//   host's filter (filterAppDomains). `frameDomains` and `baseUriDomains`
//   are ignored in v1, a further restriction the spec allows.

/** The package CDNs a bot's page may load from. */
export const BOT_HTML_CDNS = ["https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "https://unpkg.com"] as const;
const FONT_STYLES = "https://fonts.googleapis.com";
const FONT_FILES = "https://fonts.gstatic.com";

/** The bot-HTML policy, byte for byte. */
export const BOT_HTML_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' ${BOT_HTML_CDNS.join(" ")}`,
  `style-src 'unsafe-inline' ${BOT_HTML_CDNS.join(" ")} ${FONT_STYLES}`,
  `font-src data: ${BOT_HTML_CDNS.join(" ")} ${FONT_FILES}`,
  `img-src data: blob: ${BOT_HTML_CDNS.join(" ")}`,
  "media-src data: blob:",
  `connect-src ${BOT_HTML_CDNS.join(" ")}`,
  "worker-src blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "manifest-src 'none'",
].join("; ");

/** What a bot's page may reach, as AppDocument.network lists it (phones
 * enforce it below the CSP). */
export const BOT_HTML_NETWORK: { connect: string[]; resources: string[] } = {
  connect: [...BOT_HTML_CDNS],
  resources: [...BOT_HTML_CDNS, FONT_STYLES, FONT_FILES],
};

/** At most this many entries of one list survive the filter. */
export const APP_DOMAIN_LIMIT = 16;
/** A refused entry is shown in the info popover, clipped to this. */
const REFUSED_SHOWN_CHARS = 120;

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
/** A dotted host: two or more DNS labels (an IPv4 address passes too). */
const DOTTED_HOST = new RegExp(`^(?:${LABEL}\\.)+${LABEL}$`);
const PORT = /^(?:[1-9]\d{0,4})$/;

export interface AppDomainFilter {
  /** `wss://` entries are kept (connectDomains only). */
  websockets: boolean;
  /** `http://localhost[:port]` and `http://127.0.0.1[:port]` are kept: the
   * MCP server itself is a command server or a loopback URL. */
  loopback: boolean;
}

export interface FilteredDomains {
  kept: string[];
  refused: string[];
}

/** One entry as it may appear in a policy, or null. Lower-cased, one
 * trailing slash dropped; anything with a path, a query, a fragment, a
 * quote, a semicolon, a comma or whitespace is refused, as is `*` alone, a
 * wildcard anywhere but the leftmost label, userinfo, and a host without a
 * dot (outside the loopback rule). */
export function normalizeAppDomain(entry: string, filter: AppDomainFilter): string | null {
  if (entry.length > 300 || /[\s'";,\\]/.test(entry)) return null;
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#@]+?)(?::(\d+))?\/?$/i.exec(entry);
  if (!match) return null;
  const scheme = match[1]!.toLowerCase();
  const host = match[2]!.toLowerCase();
  const port = match[3];
  if (port !== undefined && (!PORT.test(port) || Number(port) > 65535)) return null;
  const suffix = port !== undefined ? `:${port}` : "";
  if (scheme === "http") {
    if (!filter.loopback || (host !== "localhost" && host !== "127.0.0.1")) return null;
    return `http://${host}${suffix}`;
  }
  if (scheme !== "https" && !(scheme === "wss" && filter.websockets)) return null;
  const bare = host.startsWith("*.") ? host.slice(2) : host;
  // `*.example.com` keeps a dotted host after the star; `*.com` does not.
  if (!DOTTED_HOST.test(bare)) return null;
  return `${scheme}://${host}${suffix}`;
}

/** The host's filter over one `_meta.ui.csp` list. Non-strings are dropped
 * without a trace; strings that fail, and entries past the limit, go to
 * `refused` for the info popover. */
export function filterAppDomains(list: unknown, filter: AppDomainFilter): FilteredDomains {
  const kept: string[] = [];
  const refused: string[] = [];
  if (!Array.isArray(list)) return { kept, refused };
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    const normal = normalizeAppDomain(entry, filter);
    if (normal && kept.includes(normal)) continue;
    if (normal && kept.length < APP_DOMAIN_LIMIT) kept.push(normal);
    else {
      // Control characters (code points under 32, and DEL) become spaces.
      const shown = [...entry].map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char)).join("").trim();
      refused.push(shown.length > REFUSED_SHOWN_CHARS ? `${shown.slice(0, REFUSED_SHOWN_CHARS - 1)}…` : shown);
    }
  }
  return { kept, refused };
}

/** The MCP-app policy for already-filtered lists: `resources` is R,
 * `connect` is C. No `'self'`: the frame's origin is opaque. */
export function mcpAppCsp(network: { connect: readonly string[]; resources: readonly string[] }): string {
  const R = network.resources.length ? ` ${network.resources.join(" ")}` : "";
  const C = network.connect.length ? network.connect.join(" ") : "'none'";
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'${R}`,
    `style-src 'unsafe-inline'${R}`,
    `font-src data:${R}`,
    `img-src data: blob:${R}`,
    `media-src data: blob:${R}`,
    `connect-src ${C}`,
    "worker-src blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/** The network set and policy of an MCP app's UI resource, from its
 * `_meta.ui.csp` (`{connectDomains?, resourceDomains?}`), after the filter.
 * `loopbackServer`: the MCP server is a command server or a loopback URL. */
export function mcpAppNetwork(csp: unknown, loopbackServer: boolean): { csp: string; network: { connect: string[]; resources: string[]; refused?: string[] } } {
  const record = csp && typeof csp === "object" && !Array.isArray(csp) ? csp as Record<string, unknown> : {};
  const connect = filterAppDomains(record.connectDomains, { websockets: true, loopback: loopbackServer });
  const resources = filterAppDomains(record.resourceDomains, { websockets: false, loopback: loopbackServer });
  const refused = [...connect.refused, ...resources.refused];
  const network = { connect: connect.kept, resources: resources.kept, ...(refused.length ? { refused } : {}) };
  return { csp: mcpAppCsp(network), network };
}
