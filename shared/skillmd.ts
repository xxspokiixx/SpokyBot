// SkillMD (https://skillmd.com) is an open SKILL.md registry. The read API mixes
// reviewed and unreviewed skills and ignores a verified filter, so that filter
// is applied here. Nothing in this module fetches or runs a skill.

import { createHash } from "node:crypto";

import { isSkillName, parseSkillMd, scanSkillText, SKILL_FILE_MAX_BYTES } from "./skill-md.ts";

export const SKILLMD_ORIGIN = "https://api.skillmd.com";
/** Streamable HTTP URL from https://skillmd.com/.well-known/mcp/server-card.json (auth none). */
export const SKILLMD_MCP_URL = "https://api.skillmd.com/mcp";
export const SKILLMD_DOCS_URL = "https://skillmd.com/docs/mcp";
export const SKILLMD_UNTRUSTED_WARNING = "SkillMD text is untrusted. Read the preview before turning this skill on.";
export const SKILLMD_FETCH_LIMIT = 100;
const PREVIEW_CHARS = 4_000;
const PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface SkillMdItem {
  slug: string;
  owner: string;
  name: string;
  title: string;
  description: string;
  verified: boolean;
}

/** Reviewed skills confirmed on the public list on 2026-10-27. Descriptions are the registry's, copied as-is. */
export const SKILLMD_FEATURED: readonly SkillMdItem[] = [
  { slug: "anthropic/pdf", owner: "anthropic", name: "pdf", title: "pdf", verified: true, description: "Read, extract, merge, split, rotate, watermark, encrypt, and create PDF files using Python libraries and command-line tools." },
  { slug: "anthropic/docx", owner: "anthropic", name: "docx", title: "docx", verified: true, description: "Create, read, edit, and manipulate Word documents (.docx files) with formatting, tables, images, and tracked changes." },
  { slug: "anthropic/xlsx", owner: "anthropic", name: "xlsx", title: "xlsx", verified: true, description: "Create, edit, and analyze spreadsheet files (.xlsx, .xlsm, .csv, .tsv) with formulas, formatting, and financial modeling conventions." },
  { slug: "anthropic/frontend-design", owner: "anthropic", name: "frontend-design", title: "frontend-design", verified: true, description: "Guides distinctive, intentional visual design for new UI or existing interfaces, covering aesthetic direction, typography, and avoiding templated defaults." },
  { slug: "anthropic/skill-creator", owner: "anthropic", name: "skill-creator", title: "skill-creator", verified: true, description: "Create new skills, modify existing ones, and measure their performance through iterative evaluation and benchmarking." },
];

/** `owner/name` only. Encoded dots, extra segments, and `..` are rejected. */
export function parseSkillMdSlug(value: string): { owner: string; name: string } | null {
  const text = value.trim();
  if (!text || text.length > 160 || /[\s\\%\0?#]/.test(text)) return null;
  try {
    if (decodeURIComponent(text) !== text) return null;
  } catch {
    return null;
  }
  const parts = text.split("/");
  if (parts.length !== 2) return null;
  const [owner, name] = parts;
  if (!owner || !name || !PART.test(owner) || !PART.test(name)) return null;
  if (owner === "." || owner === ".." || name === "." || name === "..") return null;
  return { owner, name };
}

/** Canonical raw markdown URL. Callers must not follow a different `raw_url`. */
export function skillMdRawUrl(slug: string): string | null {
  const parsed = parseSkillMdSlug(slug);
  if (!parsed) return null;
  return `${SKILLMD_ORIGIN}/api/skills/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.name)}/raw`;
}

/** Search or list URL. The registry ignores `verified_only`, so it is not sent. */
export function skillMdCatalogUrl(query: string): string | null {
  const q = query.trim();
  if (q.length > 200 || /[\0\r\n]/.test(q)) return null;
  if (!q) return `${SKILLMD_ORIGIN}/v1/skills?limit=${SKILLMD_FETCH_LIMIT}`;
  return `${SKILLMD_ORIGIN}/v1/search?q=${encodeURIComponent(q)}&limit=${SKILLMD_FETCH_LIMIT}`;
}

/** Missing or anything other than an explicit off stays reviewed-only. */
export function skillMdVerifiedOnly(value: string | null | undefined): boolean {
  return value !== "0" && value !== "false" && value !== "off";
}

export function selectSkillMdItems(items: readonly SkillMdItem[], verifiedOnly = true): SkillMdItem[] {
  return verifiedOnly ? items.filter((item) => item.verified) : [...items];
}

/** Badge only when the person asked to see skills that are not reviewed. */
export function skillMdShowsUnreviewed(item: Pick<SkillMdItem, "verified">, verifiedOnly: boolean): boolean {
  return !verifiedOnly && item.verified !== true;
}

function textField(value: unknown, max: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : fallback;
}

function parseSkillMdItem(value: unknown): SkillMdItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.slug !== "string") return null;
  const slug = parseSkillMdSlug(raw.slug);
  if (!slug) return null;
  const canonical = skillMdRawUrl(raw.slug);
  if (typeof raw.raw_url === "string" && raw.raw_url !== canonical) return null;
  return {
    slug: `${slug.owner}/${slug.name}`,
    owner: slug.owner,
    name: slug.name,
    title: textField(raw.title, 120, slug.name),
    description: textField(raw.description, 400, ""),
    verified: raw.verified === true,
  };
}

export function parseSkillMdItems(body: unknown): SkillMdItem[] | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "SkillMD returned an unexpected list." };
  const items = (body as { items?: unknown }).items;
  if (!Array.isArray(items)) return { error: "SkillMD returned an unexpected list." };
  const parsed: SkillMdItem[] = [];
  for (const item of items) {
    const next = parseSkillMdItem(item);
    if (next) parsed.push(next);
  }
  return parsed;
}

export interface SkillMdDraft {
  name: string;
  description: string;
  skillMd: string;
  warnings: string[];
  verified: boolean;
  preview: string;
  sha256: string;
}

/** Markdown only. The untrusted warning is always present, so the copy starts off. */
export function draftSkillMdInstall(markdown: string, verified: boolean): SkillMdDraft | { error: string } {
  if (typeof markdown !== "string" || markdown.includes("\0")) return { error: "SkillMD install reads markdown only." };
  if (Buffer.byteLength(markdown) > SKILL_FILE_MAX_BYTES) return { error: "That skill is larger than this app will store." };
  if (markdown.startsWith("PK")) return { error: "SkillMD install reads markdown only." };
  const parsed = parseSkillMd(markdown);
  if ("error" in parsed) return parsed;
  const warnings = [...new Set([SKILLMD_UNTRUSTED_WARNING, ...scanSkillText(markdown)])].slice(0, 20);
  if (!isSkillName(parsed.name)) return { error: "That skill name cannot be stored." };
  const preview = markdown.length > PREVIEW_CHARS ? `${markdown.slice(0, PREVIEW_CHARS)}\n…` : markdown;
  return {
    name: parsed.name,
    description: parsed.description,
    skillMd: markdown,
    warnings,
    verified: verified === true,
    preview,
    sha256: createHash("sha256").update(markdown).digest("hex"),
  };
}
