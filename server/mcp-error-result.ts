// The Anthropic API refuses a tool_result marked is_error whose content is not all text, failing the whole turn, and other
// engines pass MCP content through as is. cua-driver (0.37.0 at least) attaches a screenshot to many failures, so every
// error result that reaches an engine keeps its text and loses the rest.
type JsonObject = Record<string, unknown>;

const ERROR_FLAG = /"isError"\s*:\s*true/u;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function omittedFromErrorNote(count: number): string {
  return count === 1
    ? "[An image or other non-text item came with this error and was left out: an error result can carry only text. To see the screen now, read the window or desktop state again.]"
    : `[${count} images or other non-text items came with this error and were left out: an error result can carry only text. To see the screen now, read the window or desktop state again.]`;
}

/** Returns the same object unless it is an error result carrying non-text content. */
export function textOnlyErrorResult<T>(result: T): T {
  if (!isObject(result) || result.isError !== true || !Array.isArray(result.content)) return result;
  const text = result.content.filter((item) => isObject(item) && item.type === "text" && typeof item.text === "string");
  const omitted = result.content.length - text.length;
  if (omitted === 0) return result;
  return { ...result, content: [...text, { type: "text", text: omittedFromErrorNote(omitted) }] } as T;
}

/** One MCP stdio frame. Only a response that says isError is parsed, so screenshots on success pass without a parse. */
export function textOnlyErrorResultLine(line: string): string {
  if (!ERROR_FLAG.test(line)) return line;
  let frame: unknown;
  try {
    frame = JSON.parse(line);
  } catch {
    return line;
  }
  if (!isObject(frame)) return line;
  const result = textOnlyErrorResult(frame.result);
  return result === frame.result ? line : JSON.stringify({ ...frame, result });
}
