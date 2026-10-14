// Chat apps (docs/superpowers/specs/2026-10-14-chat-apps-design.md): a page
// of HTML that runs in a locked, sandboxed frame inside a chat row and talks
// to MausBot over the MCP Apps bridge (io.modelcontextprotocol/ui, SEP-1865).
// Two sources share this one wire kind, `app`: bot HTML (`show_html`) and an
// MCP server's UI (`_meta.ui.resourceUri`).
//
// This file is the wire and the model-input rules. The frame document (CSP
// and srcdoc) is built in shared/app-frame/*, the bridge router in
// shared/app-frame/bridge.ts, and documents are stored by server/app-docs.ts.

export const APP_MIME = "text/html;profile=mcp-app";
export const APP_PROTOCOL_VERSION = "2026-01-26";
/** The MCP client capability key OMB advertises for MCP Apps. */
export const APP_EXTENSION_KEY = "io.modelcontextprotocol/ui";

/** Model input past these is refused with one sentence naming the field. */
export const APP_LIMITS = {
  /** show_html / update_html `html`, UTF-8 bytes after trimming. */
  htmlBytes: 256 * 1024,
  title: 80,
  fallback: 1_500,
  /** Visible page text in a written fallback, after `[App] <title>`. */
  fallbackExcerpt: 600,
  heightMin: 80,
  heightMax: 720,
  /** ui/message text, and the appMessage on the send route. */
  messageText: 4_000,
  /** ui/update-model-context, stored per row and clipped. */
  contextText: 4_000,
  /** An MCP server's UI resource, decoded. */
  mcpHtmlBytes: 2 * 1024 * 1024,
  /** tools/call arguments on the rpc route. */
  rpcArgumentsBytes: 64 * 1024,
  /** resources/read through the rpc route. */
  rpcResourceBytes: 8 * 1024 * 1024,
  /** appMessage sends per app row per hour (the server's backstop). */
  messagesPerHour: 20,
  /** rpc calls per app row per minute (the server's backstop). */
  rpcPerMinute: 60,
} as const;

export type AppSource = "html" | "mcp";

/** Origins a frame may reach, after the host's filter. `refused` lists what
 * a server asked for and the filter dropped, for the info popover. */
export interface AppNetwork {
  connect: string[];
  resources: string[];
  refused?: string[];
}

/** The latest ui/update-model-context of one app row, delivered with the
 * person's next message in its thread (server/chat-apps.ts withAppContext). */
export interface AppContextState {
  text: string;
  at: number;
  delivered: boolean;
}

/** The MCP side of an app row. */
export interface AppMcpRef {
  /** the mount name in config.json mcpServers */
  server: string;
  /** initialize serverInfo.title ?? name */
  serverTitle?: string;
  tool: string;
  /** ui://... */
  resourceUri: string;
  isError?: boolean;
}

/** An app row's payload (WireMessage.app). Never carries the HTML: a client
 * fetches the AppDocument when it mounts the frame. */
export interface AppPayload {
  v: 1;
  source: AppSource;
  /** Header title, one line, ≤ 80 chars. Bot HTML: the bot's title. MCP:
   * the tool's title, else its name. */
  title: string;
  /** Content id of the stored document (server/app-docs.ts). A new value
   * means the frame must reload. Empty when nothing could be stored
   * (`blocked`): the row then shows only its text. */
  doc: string;
  /** 0, bumped by update_html. */
  rev: number;
  /** UTF-8 bytes of the HTML, for the info popover. */
  bytes: number;
  /** Initial height in px before the frame reports its own (show_html
   * `height`, clamped 80..720). */
  height?: number;
  /** Draw the host's border and background (MCP prefersBorder; bot HTML: true). */
  border: boolean;
  /** Origins the frame may reach, after the host's filter, for the info popover. */
  network: AppNetwork;
  mcp?: AppMcpRef;
  /** The latest ui/update-model-context, delivered with the person's next
   * message in this thread. */
  context?: AppContextState;
  /** Why the document could not be stored or read when the row was written
   * (`too-large`, or an MCP server that was signed out or unreachable). The
   * row is still written, with its text. */
  blocked?: AppBlockedReason;
}

/** WireMessage.fromApp: a user row an app's ui/message sent. */
export interface AppFromRef {
  messageId: string;
  title: string;
}

/** Why an app's server calls are off, or why its document is missing.
 * `unavailable` (the UI resource could not be read when the row was
 * written: offline, wrong mime type) is an addition to the spec's list. */
export type AppBlockedReason = "signed-out" | "server-removed" | "server-disabled" | "apps-off" | "too-large" | "unavailable";

/** What the frame may do right now; hostCapabilities is built from this. */
export interface AppCan {
  serverTools: boolean;
  serverResources: boolean;
  message: boolean;
  openLinks: boolean;
  modelContext: boolean;
}

export interface AppToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: object;
  annotations?: object;
  _meta?: object;
}

export interface AppToolResult {
  content: unknown[];
  structuredContent?: unknown;
  _meta?: Record<string, unknown>;
  isError?: boolean;
}

/** What a client fetches to mount a frame
 * (GET /api/threads/:threadId/messages/:messageId/app). Never part of a
 * thread load. A document with `tool` is an MCP app; one without is bot
 * HTML (shared/app-frame/bridge.ts keys the method table on that). */
export interface AppDocument {
  v: 1;
  messageId: string;
  rev: number;
  /** Set verbatim as the iframe's srcdoc. Starts with
   * `<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="…">`. */
  srcdoc: string;
  /** The policy in that meta, repeated for phone network enforcement. */
  csp: string;
  network: { connect: string[]; resources: string[] };
  /** MCP only: hostContext.toolInfo.tool, and the two notifications. */
  tool?: AppToolDefinition;
  toolInput?: Record<string, unknown>;
  toolResult?: AppToolResult;
  can: AppCan;
  /** Why serverTools/serverResources are off: drawn as a strip under the frame. */
  blocked?: { reason: AppBlockedReason; text: string };
  /** "confirm": non-read-only model-visible tools need the Allow bar. */
  approval: "full" | "confirm";
}

/** show_html's input, once checked. `html` is the page as it will be stored
 * (wrapped when it was a fragment), before the server scrubs secrets. */
export interface ShowHtmlInput {
  html: string;
  title: string;
  height?: number;
  fallbackText?: string;
}

export interface UpdateHtmlInput {
  appId: string;
  html: string;
  title?: string;
}

export type AppInputResult<T> = { ok: true; value: T } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** UTF-8 length of a string without allocating its bytes. */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; index += 1; } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/** One line: runs of whitespace, line breaks included, become one space. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A page with neither `<html` nor `<body` is a fragment: it is wrapped in a
 * minimal document so the frame gets a head the CSP can lead. */
export function wrapHtmlFragment(html: string): string {
  if (/<(?:html|body)[\s>/]/i.test(html) || /<(?:html|body)$/i.test(html)) return html;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
}

function checkHtml(value: unknown): AppInputResult<string> {
  if (typeof value !== "string") return { ok: false, error: "html: must be a string holding one HTML document." };
  const html = value.trim();
  if (!html) return { ok: false, error: "html: is empty; send one HTML document with inline style and script." };
  const bytes = utf8Bytes(html);
  if (bytes > APP_LIMITS.htmlBytes) {
    return { ok: false, error: `html: is ${bytes} bytes, over the ${APP_LIMITS.htmlBytes}-byte limit; load libraries from a CDN and embed less data.` };
  }
  return { ok: true, value: wrapHtmlFragment(html) };
}

function checkTitle(value: unknown): AppInputResult<string> {
  if (typeof value !== "string") return { ok: false, error: "title: must be a string of 1 to 80 characters." };
  const title = oneLine(value);
  if (!title || title.length > APP_LIMITS.title) return { ok: false, error: "title: must be 1 to 80 characters on one line." };
  return { ok: true, value: title };
}

/** show_html({ html, title, height?, fallback_text? }) as the model sent it. */
export function parseShowHtmlInput(input: unknown): AppInputResult<ShowHtmlInput> {
  if (!isRecord(input)) return { ok: false, error: "show_html needs {html, title, height?, fallback_text?}." };
  const html = checkHtml(input.html);
  if (!html.ok) return html;
  const title = checkTitle(input.title);
  if (!title.ok) return title;
  const out: ShowHtmlInput = { html: html.value, title: title.value };
  if (input.height !== undefined && input.height !== null) {
    if (typeof input.height !== "number" || !Number.isFinite(input.height)) return { ok: false, error: "height: must be a number of pixels, 80 to 720." };
    out.height = Math.round(Math.min(APP_LIMITS.heightMax, Math.max(APP_LIMITS.heightMin, input.height)));
  }
  if (input.fallback_text !== undefined && input.fallback_text !== null) {
    if (typeof input.fallback_text !== "string") return { ok: false, error: "fallback_text: must be a string." };
    const fallback = input.fallback_text.trim();
    if (fallback.length > APP_LIMITS.fallback) return { ok: false, error: `fallback_text: must be at most ${APP_LIMITS.fallback} characters.` };
    if (fallback) out.fallbackText = fallback;
  }
  return { ok: true, value: out };
}

/** update_html({ app_id, html, title? }) as the model sent it. */
export function parseUpdateHtmlInput(input: unknown): AppInputResult<UpdateHtmlInput> {
  if (!isRecord(input)) return { ok: false, error: "update_html needs {app_id, html, title?}." };
  if (typeof input.app_id !== "string" || !/^[\w-]{1,128}$/.test(input.app_id.trim())) {
    return { ok: false, error: "app_id: is required, the id show_html returned." };
  }
  const html = checkHtml(input.html);
  if (!html.ok) return html;
  const out: UpdateHtmlInput = { appId: input.app_id.trim(), html: html.value };
  if (input.title !== undefined && input.title !== null) {
    const title = checkTitle(input.title);
    if (!title.ok) return title;
    out.title = title.value;
  }
  return { ok: true, value: out };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'" };

/** The words a person would read on the page: script, style, comments and
 * tags gone, a few entities decoded, whitespace collapsed. A preview, not a
 * parser: it only ever feeds the row's readable fallback. */
export function htmlVisibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    .replace(/<(script|style|template|noscript|title|head)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, " ")
    .replace(/<[^>]*>?/g, " ")
    .replace(/&(#\d+|#x[\da-f]+|[a-z]+\d*);/gi, (whole, name: string) => {
      const lower = name.toLowerCase();
      if (ENTITIES[lower] !== undefined) return ENTITIES[lower]!;
      const code = lower.startsWith("#x") ? Number.parseInt(lower.slice(2), 16) : lower.startsWith("#") ? Number.parseInt(lower.slice(1), 10) : NaN;
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

/** An app row's readable fallback (its `text`): `fallback_text` when the bot
 * gave one, else `[App] <title>` and up to 600 characters of the page's
 * visible text. Previews, notifications, channels and replayed history read it. */
export function htmlFallbackText(title: string, html: string, fallbackText?: string): string {
  const given = fallbackText?.trim();
  if (given) return clip(given, APP_LIMITS.fallback);
  const visible = clip(htmlVisibleText(html), APP_LIMITS.fallbackExcerpt);
  return clip(visible ? `[App] ${title}\n${visible}` : `[App] ${title}`, APP_LIMITS.fallback);
}

/** What an MCP app row reads as: `<serverTitle> · <tool title>` and up to
 * 600 characters of the result's text content. */
export function mcpAppFallbackText(serverTitle: string, toolTitle: string, result: { content?: unknown } | undefined): string {
  const texts = Array.isArray(result?.content)
    ? result.content.flatMap((block) => (isRecord(block) && block.type === "text" && typeof block.text === "string" ? [block.text] : []))
    : [];
  const excerpt = clip(oneLine(texts.join(" ")), APP_LIMITS.fallbackExcerpt);
  const head = `${oneLine(serverTitle)} · ${oneLine(toolTitle)}`;
  return clip(excerpt ? `${head}\n${excerpt}` : head, APP_LIMITS.fallback);
}

/** The strip under a frame whose server calls are off, per reason. */
export function appBlockedText(reason: AppBlockedReason, server?: string): string {
  const name = server?.trim() || "This app's server";
  switch (reason) {
    case "signed-out": return `Sign in to ${name} again`;
    case "server-removed":
    case "server-disabled":
    case "apps-off": return `${name} is no longer connected`;
    case "too-large": return "This app is too large to store";
    case "unavailable": return `${name} did not send this app's page`;
  }
}
