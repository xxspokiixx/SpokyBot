import { describe, expect, it } from "vitest";

import { omittedFromErrorNote, textOnlyErrorResult, textOnlyErrorResultLine } from "./mcp-error-result.ts";

const PNG = "iVBORw0KGgo=";
// The shape cua-driver 0.37.0 answers a refused pixel click with: text, a screenshot, and structured content.
const refusedClick = {
  content: [
    { type: "text", text: "Pixel click refused: read the window with get_window_state first." },
    { type: "image", data: PNG, mimeType: "image/png" },
  ],
  structuredContent: { code: "window_state_required" },
  isError: true,
};

describe("textOnlyErrorResult", () => {
  it("keeps an error's text and structured content, drops its image, and says so", () => {
    expect(textOnlyErrorResult(refusedClick)).toEqual({
      content: [
        { type: "text", text: "Pixel click refused: read the window with get_window_state first." },
        { type: "text", text: omittedFromErrorNote(1) },
      ],
      structuredContent: { code: "window_state_required" },
      isError: true,
    });
  });

  it("counts every non-text item, including audio and resources", () => {
    const result = textOnlyErrorResult({
      isError: true,
      content: [
        { type: "image", data: PNG, mimeType: "image/png" },
        { type: "audio", data: "AAAA", mimeType: "audio/wav" },
        { type: "resource", resource: { uri: "file:///tmp/x", text: "x" } },
      ],
    });
    expect(result.content).toEqual([{ type: "text", text: omittedFromErrorNote(3) }]);
    expect(omittedFromErrorNote(3)).toMatch(/^\[3 images or other non-text items came with this error and were left out/);
  });

  it("returns successes, text-only errors and malformed values as the same object", () => {
    const shot = { content: [{ type: "image", data: PNG, mimeType: "image/png" }] };
    const textError = { content: [{ type: "text", text: "no such window" }], isError: true };
    const truthyNotTrue = { content: [{ type: "image", data: PNG, mimeType: "image/png" }], isError: "true" };
    for (const value of [shot, textError, truthyNotTrue, null, "text", { isError: true }]) {
      expect(textOnlyErrorResult(value)).toBe(value);
    }
  });
});

describe("textOnlyErrorResultLine", () => {
  it("rewrites a tools/call error frame and keeps its id", () => {
    const line = JSON.stringify({ jsonrpc: "2.0", id: "call-7", result: refusedClick });
    const frame = JSON.parse(textOnlyErrorResultLine(line));
    expect(frame.id).toBe("call-7");
    expect(frame.result.isError).toBe(true);
    expect(frame.result.content.map((item: { type: string }) => item.type)).toEqual(["text", "text"]);
    expect(JSON.stringify(frame)).not.toContain(PNG);
  });

  it("passes every other line through byte for byte", () => {
    const success = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "image", data: PNG, mimeType: "image/png" }] } });
    const textError = JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "bad" }], isError: true } });
    const request = JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { isError: true, content: [{ type: "image" }] } });
    const notJson = '{"isError": true, not json';
    for (const line of [success, textError, request, notJson, ""]) expect(textOnlyErrorResultLine(line)).toBe(line);
  });

  it("recognises the flag with whitespace a server may print", () => {
    const line = `{"jsonrpc": "2.0", "id": 4, "result": {"isError" : true, "content": [{"type": "image", "data": "${PNG}", "mimeType": "image/png"}]}}`;
    expect(JSON.parse(textOnlyErrorResultLine(line)).result.content).toEqual([{ type: "text", text: omittedFromErrorNote(1) }]);
  });
});
