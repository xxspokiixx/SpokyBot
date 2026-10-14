// What OMB's own MCP plumbing sees of an MCP App (docs/superpowers/specs/
// 2026-10-14-chat-apps-design.md, Decision 6 and "The observer report").
//
// Shared by the gate (mcp-gate.ts, a command server's frames), the remote
// proxy (mcp-remote-proxy.ts, a URL server) and the Chat Completions runtime
// (drivers/chat-mcp-tools.ts, its in-process stdio client). Only the
// innermost OMB component on a server's path observes it, so a call is
// reported once.
//
// Pure apart from the post: it keeps the latest tools/list definitions in
// memory, and when a tools/call result comes back for a tool with a UI it
// posts that call to the harness (POST /api/internal/options-card with
// `tool: "mcp_app"`, under the turn's agents capability). The post is fire
// and forget: it never delays or alters what is relayed to the engine, it
// times out after 10 s, and a failure goes to stderr only. The report is
// serialised when the result arrives, before the gate trims it.
//
// The helpers below (a tool's UI, its visibility, the extension capability)
// are also what the catalog (mcp-app-catalog.ts) and the rpc route
// (chat-apps-mcp.ts) read, so every part of OMB agrees on what an app is.
// This module runs inside spawned proxies: it imports nothing heavy.
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import { APP_EXTENSION_KEY, APP_MIME } from "../shared/app.ts";

/** What a model's tools/call to an app-only tool is refused with. */
export const APP_ONLY_REFUSAL = "This tool belongs to an app view.";
/** The whole report body, under the internal route's 1,000,000-byte cap. */
export const APP_REPORT_MAX_BYTES = 900 * 1024;
export const APP_REPORT_TIMEOUT_MS = 10_000;
/** The mount settings' env names: the gate's and the remote proxy's. */
export const GATE_APPS_ENV = "OMB_GATE_APPS";
export const REMOTE_MCP_APPS_ENV = "OMB_REMOTE_MCP_APPS";

/** The capability OMB adds to its initialize: `extensions[APP_EXTENSION_KEY]`. */
export const UI_EXTENSION = { mimeTypes: [APP_MIME] } as const;

/** One observing mount's settings, in its private env record. The capability
 * is the turn's agents capability (OMB_HARNESS_URL, OMB_COMMS_TOKEN). */
export interface AppMount {
  /** the mount name in config.json mcpServers */
  server: string;
  harnessUrl: string;
  token: string;
  /** Advertise the UI extension (off once the server refused it). */
  extension: boolean;
}

type Json = Record<string, unknown>;
function isRecord(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const SERVER_NAME = /^[a-z][a-z0-9_-]{0,31}$/;

/** A mount's settings as its process reads them, or undefined when absent.
 * Present but unreadable throws: a mount told to observe never silently
 * stops observing. */
export function parseAppMount(raw: string | undefined): AppMount | undefined {
  if (raw === undefined) return undefined;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("invalid MCP apps configuration"); }
  if (!isRecord(value) || typeof value.server !== "string" || !SERVER_NAME.test(value.server)
    || typeof value.harnessUrl !== "string" || typeof value.token !== "string" || !value.token || typeof value.extension !== "boolean") {
    throw new Error("invalid MCP apps configuration");
  }
  try {
    const url = new URL(value.harnessUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  } catch { throw new Error("invalid MCP apps configuration"); }
  return { server: value.server, harnessUrl: value.harnessUrl, token: value.token, extension: value.extension };
}

/** `_meta.ui` of a tool or a resource, or undefined. */
export function uiMeta(item: unknown): Json | undefined {
  const meta = isRecord(item) ? item._meta : undefined;
  return isRecord(meta) && isRecord(meta.ui) ? meta.ui : undefined;
}

/** A tool's UI resource: `_meta.ui.resourceUri`, else the deprecated flat
 * `_meta["ui/resourceUri"]`. Only a `ui://` URI is a UI. */
export function toolUiResource(tool: unknown): string | undefined {
  const meta = isRecord(tool) && isRecord(tool._meta) ? tool._meta : undefined;
  const ui = uiMeta(tool);
  const uri = typeof ui?.resourceUri === "string" ? ui.resourceUri : typeof meta?.["ui/resourceUri"] === "string" ? meta["ui/resourceUri"] : undefined;
  return uri && uri.startsWith("ui://") && uri.length <= 2_048 ? uri : undefined;
}

export type AppVisibility = "model" | "app";

/** Who may call a tool: `_meta.ui.visibility`, default model and app. */
export function toolVisibility(tool: unknown): AppVisibility[] {
  const list = uiMeta(tool)?.visibility;
  if (!Array.isArray(list)) return ["model", "app"];
  return (["model", "app"] as const).filter((who) => list.includes(who));
}

/** False only for a tool whose visibility is set and lacks "model". */
export function modelVisible(tool: unknown): boolean {
  return toolVisibility(tool).includes("model");
}

/** A tools/list result with the app-only tools dropped (rule 16). Anything
 * that is not a tool list is returned as it came. */
export function withoutAppOnlyTools<T>(result: T): T {
  if (!isRecord(result) || !Array.isArray(result.tools) || result.tools.every(modelVisible)) return result;
  return { ...result, tools: result.tools.filter(modelVisible) } as T;
}

/** initialize params with the UI extension advertised, the rest untouched. */
export function withUiExtension(params: unknown): Json {
  const base = isRecord(params) ? params : {};
  const capabilities = isRecord(base.capabilities) ? base.capabilities : {};
  const extensions = isRecord(capabilities.extensions) ? capabilities.extensions : {};
  return { ...base, capabilities: { ...capabilities, extensions: { ...extensions, [APP_EXTENSION_KEY]: UI_EXTENSION } } };
}

/** The tool definition fields a report and an AppDocument carry. */
export interface AppToolDefinitionReport {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: object;
  annotations?: object;
  _meta: object;
}

export interface McpAppReport {
  tool: "mcp_app";
  server: string;
  serverInfo?: { name?: string; title?: string; version?: string };
  definition: AppToolDefinitionReport;
  call: { arguments: Record<string, unknown>; toolUseId?: string };
  result: { content: unknown[]; structuredContent?: unknown; _meta?: Record<string, unknown>; isError?: boolean };
  /** set when structuredContent was dropped to fit */
  oversized?: true;
}

function definitionOf(tool: Json): AppToolDefinitionReport {
  return {
    name: String(tool.name),
    ...(typeof tool.title === "string" ? { title: tool.title } : {}),
    ...(typeof tool.description === "string" ? { description: tool.description } : {}),
    ...(isRecord(tool.inputSchema) ? { inputSchema: tool.inputSchema } : {}),
    ...(isRecord(tool.annotations) ? { annotations: tool.annotations } : {}),
    _meta: isRecord(tool._meta) ? tool._meta : {},
  };
}

function serverInfoOf(result: unknown): McpAppReport["serverInfo"] | undefined {
  const info = isRecord(result) && isRecord(result.serverInfo) ? result.serverInfo : undefined;
  if (!info) return undefined;
  const out: NonNullable<McpAppReport["serverInfo"]> = {};
  for (const key of ["name", "title", "version"] as const) if (typeof info[key] === "string") out[key] = (info[key] as string).slice(0, 200);
  return Object.keys(out).length ? out : undefined;
}

const bytes = (text: string) => Buffer.byteLength(text);

/** The report's JSON, at most APP_REPORT_MAX_BYTES: structuredContent goes
 * first (and `oversized` is set), then content that is not text, then the
 * text is clipped. Null when even that does not fit (a call whose arguments
 * alone are too large). */
export function appReportBody(report: McpAppReport, maxBytes = APP_REPORT_MAX_BYTES): string | null {
  let body = JSON.stringify(report);
  if (bytes(body) <= maxBytes) return body;
  const { structuredContent: _dropped, ...result } = report.result;
  let smaller: McpAppReport = { ...report, result, oversized: true };
  body = JSON.stringify(smaller);
  if (bytes(body) <= maxBytes) return body;
  const texts = result.content.filter((block) => isRecord(block) && block.type === "text" && typeof block.text === "string") as Array<{ type: "text"; text: string }>;
  smaller = { ...smaller, result: { ...result, content: texts } };
  body = JSON.stringify(smaller);
  if (bytes(body) <= maxBytes) return body;
  const over = bytes(body) - maxBytes;
  const total = texts.reduce((sum, block) => sum + bytes(block.text), 0);
  if (total <= over) return null;
  // Each block keeps its share of what is left; JSON escaping can make a
  // character cost more than its UTF-8 bytes, so shrink until it fits.
  for (let keep = (total - over) / total; keep > 0.01; keep *= 0.8) {
    const clipped = texts.map((block) => ({ type: "text" as const, text: `${block.text.slice(0, Math.floor(block.text.length * keep))}…` }));
    body = JSON.stringify({ ...smaller, result: { ...result, content: clipped } });
    if (bytes(body) <= maxBytes) return body;
  }
  return null;
}

/** POST one report to the harness: fire and forget. */
export function postAppReport(mount: Pick<AppMount, "harnessUrl" | "token">, body: string, log: (line: string) => void): Promise<void> {
  return new Promise((resolve) => {
    let url: URL;
    try { url = new URL("/api/internal/options-card", mount.harnessUrl); } catch { resolve(); return; }
    // node:http rather than fetch: the harness is on loopback, and an
    // engine's environment may switch on Node's env proxy for fetch.
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = send(url, {
      method: "POST",
      headers: { authorization: `Bearer ${mount.token}`, "content-type": "application/json", "content-length": String(bytes(body)) },
      timeout: APP_REPORT_TIMEOUT_MS,
    }, (response) => {
      const status = response.statusCode ?? 0;
      response.resume();
      if (status < 200 || status >= 300) log(`app report answered HTTP ${status}`);
      response.on("end", resolve);
      response.on("error", () => resolve());
    });
    request.on("timeout", () => { request.destroy(new Error("timed out")); });
    request.on("error", (error) => { log(`app report failed: ${error.message}`); resolve(); });
    request.end(body);
  });
}

export interface AppObserverOptions {
  /** Where a report goes (tests). Default: postAppReport to the mount's harness. */
  post?: (body: string) => Promise<void>;
  /** stderr: the only place an observer may speak. */
  log?: (line: string) => void;
}

/** One server's observer: one per gate, proxy or in-process client. */
export class AppObserver {
  readonly mount: AppMount;
  private readonly tools = new Map<string, Json>();
  private info: McpAppReport["serverInfo"] | undefined;
  private readonly post: (body: string) => Promise<void>;
  private readonly log: (line: string) => void;
  /** Reports still in flight (tests wait on them; nothing else does). */
  readonly inFlight = new Set<Promise<void>>();

  constructor(mount: AppMount, options: AppObserverOptions = {}) {
    this.mount = mount;
    this.log = options.log ?? ((line) => process.stderr.write(`mcp apps(${mount.server}): ${line}\n`));
    this.post = options.post ?? ((body) => postAppReport(mount, body, this.log));
  }

  /** An initialize result: who the server says it is. */
  initialized(result: unknown): void {
    this.info = serverInfoOf(result) ?? this.info;
  }

  /** A tools/list page as the server sent it, before anything is filtered.
   * Definitions accumulate across pages and are replaced by name. */
  listed(result: unknown): void {
    if (!isRecord(result) || !Array.isArray(result.tools)) return;
    for (const tool of result.tools) {
      if (isRecord(tool) && typeof tool.name === "string" && tool.name) this.tools.set(tool.name, tool);
    }
  }

  /** Whether the model must not call this tool: its listed visibility lacks "model". */
  appOnly(name: unknown): boolean {
    const tool = typeof name === "string" ? this.tools.get(name) : undefined;
    return tool !== undefined && !modelVisible(tool);
  }

  /** A tools/call result came back: report it when the tool has a UI. The
   * report is built now, from the result as the server sent it. */
  returned(params: unknown, result: unknown): void {
    try {
      if (!isRecord(params) || typeof params.name !== "string" || !isRecord(result) || !Array.isArray(result.content)) return;
      const tool = this.tools.get(params.name);
      if (!tool || !toolUiResource(tool)) return;
      const meta = isRecord(params._meta) ? params._meta : undefined;
      const toolUseId = typeof meta?.["claudecode/toolUseId"] === "string" ? (meta["claudecode/toolUseId"] as string).slice(0, 200) : undefined;
      const report: McpAppReport = {
        tool: "mcp_app",
        server: this.mount.server,
        ...(this.info ? { serverInfo: this.info } : {}),
        definition: definitionOf(tool),
        call: { arguments: isRecord(params.arguments) ? params.arguments : {}, ...(toolUseId ? { toolUseId } : {}) },
        result: {
          content: result.content,
          ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
          ...(isRecord(result._meta) ? { _meta: result._meta } : {}),
          ...(typeof result.isError === "boolean" ? { isError: result.isError } : {}),
        },
      };
      const body = appReportBody(report);
      if (body === null) { this.log(`${params.name}: the call is too large to show as an app`); return; }
      const sent = this.post(body).catch((error: unknown) => this.log(`app report failed: ${String(error)}`));
      this.inFlight.add(sent);
      void sent.finally(() => this.inFlight.delete(sent));
    } catch (error) {
      // An observer never breaks the relay.
      this.log(`could not report a call: ${String(error)}`);
    }
  }
}
