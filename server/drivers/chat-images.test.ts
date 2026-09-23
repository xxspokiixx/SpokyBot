import { describe, expect, it } from "vitest";
import { assertImageTransport, CHAT_IMAGE_BUDGET, chatImageBudget } from "./chat-images.ts";

describe("chat image transport and retained budget", () => {
  it("counts input and successive screenshot batches against one budget", () => {
    const retain = chatImageBudget();
    const part = { type: "image_url" as const, image_url: { url: "x".repeat(CHAT_IMAGE_BUDGET / 2) } };
    retain([part]);
    retain("ordinary text");
    retain([part]);
    expect(() => retain([{ type: "image_url", image_url: { url: "x" } }])).toThrow("cannot be retained");
    expect(() => chatImageBudget()([part])).not.toThrow();
  });
  it.each(["https://api.example.com/v1", "http://localhost:8000/v1", "http://127.0.0.1:8000/v1", "http://[::1]:8000/v1"])("allows encrypted or loopback transport: %s", url => {
    expect(() => assertImageTransport(url)).not.toThrow();
  });
  it.each(["http://api.example.com/v1", "http://localhost.example.com/v1", "http://192.168.1.4/v1", "ftp://localhost/v1"])("refuses remote cleartext or unsupported transport: %s", url => {
    expect(() => assertImageTransport(url)).toThrow("require HTTPS");
  });
});
