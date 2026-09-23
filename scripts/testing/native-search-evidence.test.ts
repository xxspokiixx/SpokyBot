import { expect, it } from "vitest";
import { verifiedNativeSearch } from "./native-search-evidence.ts";
const url = "https://developers.openai.com/docs/browser?surface=app";
const result = { type: "text_result", url, title: "Browser", snippet: "Source text" };
const search = { action: { type: "search" }, results: [result] };
const reply = [{ role: "bot", kind: "text", text: `Answer [source](${url}).` }];
const opened = { action: { type: "openPage" }, results: [result] };
it("requires a successful opened page matching the answer citation", () => {
  expect(verifiedNativeSearch("settled", [search, opened], reply)).toBe(true);
  for (const action of [undefined, { type: "other" }, { type: "search" }])
    expect(verifiedNativeSearch("settled", [search, { action, results: [result] }], reply)).toBe(false);
  expect(verifiedNativeSearch("settled", [search, { ...opened, results: [{ ...result, url: url + "-other" }] }], reply)).toBe(false);
  expect(verifiedNativeSearch("settled", [search, { ...opened, results: [{ ...result, title: "Internal Error" }] }], reply)).toBe(false);
  expect(verifiedNativeSearch("settled", [search, opened], [{ ...reply[0], text: "No citation" }])).toBe(false);
  expect(verifiedNativeSearch("failed", [search, opened], reply)).toBe(false);
});

it("rejects earlier citations and disclaimed or bare URLs in the final answer", () => {
  for (const text of ["I could not verify the answer.", `I cannot cite this page: ${url}`, `I cannot verify [this page](${url}).`, `Unverified: [source](${url}).`, `Source: ${url}`]) {
    expect(verifiedNativeSearch("settled", [search, opened], [...reply, { ...reply[0], text }]), text).toBe(false);
  }
  expect(verifiedNativeSearch("settled", [search, opened], [{ ...reply[0], text: "Searching…" }, ...reply])).toBe(true);
});
