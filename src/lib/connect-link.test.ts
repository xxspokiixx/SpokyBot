import { expect, it } from "vitest";

import { takeConnectRequest } from "./connect-link";

it("a bot's connect link opens the page that connects it and leaves the address clean", () => {
  expect(takeConnectRequest("https://omb-u-1.fly.dev/?connect=mcp%3Alinear&x=1#top")).toEqual({ rest: "/?x=1#top", surface: "mcp" });
  expect(takeConnectRequest("https://omb-u-1.fly.dev/?connect=highlevel")).toEqual({ rest: "/", surface: "apps" });
  expect(takeConnectRequest("https://omb-u-1.fly.dev/?connect=javascript:alert(1)")).toEqual({ rest: "/", surface: "apps" });
  expect(takeConnectRequest("https://omb-u-1.fly.dev/?x=1")).toBeNull();
});
