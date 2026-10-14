// The frame document (docs/superpowers/specs/2026-10-14-chat-apps-design.md,
// Decision 4 and security rules 2 and 3). The server assembles `srcdoc`
// once: our doctype, the CSP meta as the very first element, then (bot HTML
// only) the theme variables and the helper, then the app's content. Clients
// set it verbatim, so CSP construction and injection live in this one
// tested function rather than in three renderers.
//
// No byte of app content precedes the meta. A leading BOM, whitespace,
// comments, bogus comments (`<?xml …?>`, `<![CDATA[…]>`) and the app's own
// doctype are stripped first; whatever the app wrote after that follows our
// meta, which already sits in the head the parser opened for it.
import type { AppCan, AppDocument, AppToolDefinition, AppToolResult } from "../app.ts";
import { BOT_HTML_CSP, BOT_HTML_NETWORK, mcpAppCsp } from "./csp.ts";
import { APP_HELPER_SOURCE, APP_THEME_STYLE } from "./helper.ts";

/** Every AppDocument.srcdoc starts with exactly this. */
export const CSP_META_PREFIX = "<!DOCTYPE html><meta http-equiv=\"Content-Security-Policy\" content=\"";

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The app's HTML with everything that may legally precede its first
 * element removed: BOM, whitespace, comments, bogus comments and doctypes,
 * in any order and any number. An unterminated comment swallows the rest,
 * as a browser would. */
export function stripDocumentPreamble(html: string): string {
  let rest = html;
  for (;;) {
    const before = rest;
    rest = rest.replace(/^[﻿\s]+/, "");
    if (rest.startsWith("<!--")) {
      const end = rest.indexOf("-->", 4);
      rest = end === -1 ? "" : rest.slice(end + 3);
    } else if (/^<[!?]/.test(rest)) {
      const end = rest.indexOf(">");
      rest = end === -1 ? "" : rest.slice(end + 1);
    }
    if (rest === before) return rest;
  }
}

/** The iframe's srcdoc: our doctype and CSP meta first, then for bot HTML
 * the theme style and the helper, then the app's HTML. */
export function buildSrcdoc(input: { html: string; csp: string; botHelper?: boolean }): string {
  const head = `${CSP_META_PREFIX}${escapeAttribute(input.csp)}">`;
  const helper = input.botHelper ? `<style>${APP_THEME_STYLE}</style><script>${APP_HELPER_SOURCE}</script>` : "";
  return `${head}${helper}${stripDocumentPreamble(input.html)}`;
}

/** What a bot's page may do: everything but reach a server. */
export const BOT_HTML_CAN: AppCan = { serverTools: false, serverResources: false, message: true, openLinks: true, modelContext: true };

/** The AppDocument of a bot-HTML row. `html` is the stored page. */
export function botHtmlDocument(input: { messageId: string; rev: number; html: string; approval: "full" | "confirm" }): AppDocument {
  return {
    v: 1,
    messageId: input.messageId,
    rev: input.rev,
    srcdoc: buildSrcdoc({ html: input.html, csp: BOT_HTML_CSP, botHelper: true }),
    csp: BOT_HTML_CSP,
    network: { connect: [...BOT_HTML_NETWORK.connect], resources: [...BOT_HTML_NETWORK.resources] },
    can: { ...BOT_HTML_CAN },
    approval: input.approval,
  };
}

/** The AppDocument of an MCP app row. `network` is already filtered
 * (csp.ts mcpAppNetwork); the policy is rebuilt from it. */
export function mcpAppDocument(input: {
  messageId: string;
  rev: number;
  html: string;
  network: { connect: string[]; resources: string[] };
  tool: AppToolDefinition;
  toolInput?: Record<string, unknown>;
  toolResult?: AppToolResult;
  can: AppCan;
  blocked?: AppDocument["blocked"];
  approval: "full" | "confirm";
}): AppDocument {
  const network = { connect: [...input.network.connect], resources: [...input.network.resources] };
  const csp = mcpAppCsp(network);
  return {
    v: 1,
    messageId: input.messageId,
    rev: input.rev,
    srcdoc: buildSrcdoc({ html: input.html, csp }),
    csp,
    network,
    tool: input.tool,
    ...(input.toolInput ? { toolInput: input.toolInput } : {}),
    ...(input.toolResult ? { toolResult: input.toolResult } : {}),
    can: { ...input.can },
    ...(input.blocked ? { blocked: input.blocked } : {}),
    approval: input.approval,
  };
}
