import { readFileSync, statSync } from "node:fs";
import type { SendTurnInput } from "../contracts.ts";

export interface ChatImagePart { type: "image_url"; image_url: { url: string } }
export interface ChatTextPart { type: "text"; text: string }
export type ChatContentPart = ChatTextPart | ChatImagePart;
const IMAGE_BYTES = 20 * 1024 * 1024;
const MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function chatImage(item: { mimeType?: unknown; data?: unknown }): ChatImagePart {
  const { mimeType, data } = item;
  if (typeof mimeType !== "string" || !MIME.has(mimeType) || typeof data !== "string" ||
      !data.length || data.length > Math.ceil(IMAGE_BYTES / 3) * 4 || data.length % 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    throw new Error("Invalid or oversized MCP image");
  }
  return { type: "image_url", image_url: { url: `data:${mimeType};base64,${data}` } };
}

export function chatUserContent(turn: SendTurnInput): string | ChatContentPart[] {
  if (!turn.images?.length) return turn.text;
  return [{ type: "text", text: turn.text }, ...turn.images.map(image => {
    if (statSync(image.path).size > IMAGE_BYTES) throw new Error("Image exceeds 20 MB");
    return chatImage({ mimeType: image.mime, data: readFileSync(image.path).toString("base64") });
  })];
}

export function chatToolImages(callId: string, images?: ChatImagePart[]): ChatContentPart[] {
  return images?.length ? [{ type: "text", text: `Screenshot result from tool call ${callId}:` }, ...images] : [];
}
