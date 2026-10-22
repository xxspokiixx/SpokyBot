import { extractMcpImages } from "../../mcp-tool-images.ts";
import { toolDetailPreview } from "../../tool-summary.ts";

export type AcpToolEndEvent = { type: "item.completed" } & (
  | { itemType: "tool"; itemId: string | undefined; ok: boolean; output?: string }
  | { itemType: "assistant_image"; data: string }
);

/** The events that end a finished tool item: its completion, then any images its result carries. */
export function acpToolEndEvents(
  update: { status?: unknown; rawOutput?: unknown; content?: unknown },
  itemId: string | undefined,
): AcpToolEndEvent[] {
  return [
    { type: "item.completed", itemType: "tool", itemId, ok: update.status !== "failed", output: toolDetailPreview(update.rawOutput ?? update.content) },
    ...extractMcpImages(update.content ?? update.rawOutput).map((img): AcpToolEndEvent => ({ type: "item.completed", itemType: "assistant_image", data: img.data })),
  ];
}
