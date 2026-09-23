type SearchItem = {
  action?: { type?: string };
  results?: Array<{ type?: string; url?: string; title?: string; snippet?: string }>;
};
const officialUrl = (raw: string) => {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !["learn.chatgpt.com", "developers.openai.com"].includes(url.hostname)) return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
};
const results = (item: SearchItem) => (item.results ?? []).filter(result =>
  result.type === "text_result" && result.url && result.snippet && result.title !== "Internal Error");

/** An answer must cite an official page that a successful openPage returned. */
export function verifiedNativeSearch(status: string | undefined, items: SearchItem[], messages: Array<{ role: string; kind: string; text?: string }>) {
  if (status !== "settled" || !items.some(item => item.action?.type === "search" && results(item).length)) return false;
  const opened = new Set(items.filter(item => item.action?.type === "openPage").flatMap(results)
    .map(result => officialUrl(result.url!)).filter((url): url is string => url !== null));
  return messages.some(message => message.role === "bot" && message.kind === "text" &&
    [...(message.text ?? "").matchAll(/https:\/\/[^\s<>[\]()]+/g)].some(match => {
      const url = officialUrl(match[0].replace(/[.,;!]+$/, ""));
      return url !== null && opened.has(url);
    }));
}
