import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ToolCallContext } from "./agents-call.ts";
import { availableTools, callableTools, catalogProfileFromEnv } from "./agents-catalog.ts";
import type { Json } from "./agents-client.ts";
import { agentsMcp } from "./agents-mcp.ts";
import { callWaitTool, WAIT_TOOL_DEFINITIONS, WAIT_TOOL_NAMES } from "./agents-wait-tools.ts";
import { WAIT_KINDS } from "../../shared/waits.ts";

type Reply = { ok: boolean; status: number; body: Record<string, unknown> };

function setup(reply: Reply = { ok: true, status: 200, body: { text: "ok" } }) {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const client = { apiResponse: async (path: string, init?: RequestInit) => { calls.push([path, init]); return reply; } };
  return { calls, context: { botId: "scout", threadId: "t1", client } as unknown as ToolCallContext };
}

describe("wait tools", () => {
  it("sends wait_until's arguments unchanged to the waits route and returns its words", async () => {
    const { calls, context } = setup({ ok: true, status: 201, body: { text: "Waiting for the build (wait id w1)…" } });
    expect(await callWaitTool("wait_until", { label: "the build", kind: "file_exists", path: "/r" }, context)).toEqual({ text: "Waiting for the build (wait id w1)…" });
    expect(calls).toEqual([["/api/internal/waits", { method: "POST", body: JSON.stringify({ label: "the build", kind: "file_exists", path: "/r" }) }]]);
  });

  it("marks a refusal as an error in the route's words", async () => {
    const { context } = setup({ ok: false, status: 403, body: { error: "Only the person can set up or stop a wait…" } });
    expect(await callWaitTool("wait_until", {}, context)).toEqual({ text: "Only the person can set up or stop a wait…", isError: true });
  });

  it("lists with a GET and cancels by id", async () => {
    const { calls, context } = setup();
    await callWaitTool("list_waits", {}, context);
    await callWaitTool("cancel_wait", { id: "w1" }, context);
    expect(calls).toEqual([["/api/internal/waits", undefined], ["/api/internal/waits/cancel", { method: "POST", body: '{"id":"w1"}' }]]);
  });

  it("defines the three tools in order, with follow_up and never then", () => {
    expect(WAIT_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual(["wait_until", "list_waits", "cancel_wait"]);
    expect([...WAIT_TOOL_NAMES]).toEqual(["wait_until", "list_waits", "cancel_wait"]);
    const waitUntil = WAIT_TOOL_DEFINITIONS.find((tool) => tool.name === "wait_until")!;
    const properties = (waitUntil.inputSchema as unknown as { properties: Record<string, { enum?: string[] }> }).properties;
    expect(Object.keys(properties)).toEqual(["label", "kind", "url", "text", "path", "process", "bot", "follow_up", "hours"]);
    expect(properties.kind!.enum).toEqual([...WAIT_KINDS]);
    expect(JSON.stringify(WAIT_TOOL_DEFINITIONS)).not.toMatch(/"then"|with then|give then/);
  });

  it("tells the model in few words: no AI while waiting, every kind, follow_up, 1 to 168 hours and a noun-phrase label", () => {
    const [waitUntil, list] = WAIT_TOOL_DEFINITIONS;
    const properties = (waitUntil!.inputSchema as unknown as { properties: Record<string, { description?: string }> }).properties;
    expect(waitUntil!.description).toContain("No AI runs while you wait");
    expect(waitUntil!.description).toContain("(default 24, 1-168)");
    for (const prefix of ["url_*", "file_*", "process_*", "bot_idle"]) expect(properties.kind!.description).toContain(prefix);
    expect(properties.follow_up!.description).toMatch(/^Only if the person asked for something to be done then.*You carry it out here\.$/);
    expect(properties.label!.description).toBe('A noun phrase in the person\'s words, e.g. "the build".');
    expect(list!.description).toMatch(/^Your waits in this chat that have not ended/);
    // The advertised bytes ride every turn that lists it: the catalog wire test budgets them, this keeps them small.
    const [advertised] = availableTools(catalogProfileFromEnv({ OMB_BOT_ID: "scout" })).filter((tool) => tool.name === "wait_until");
    expect(JSON.stringify(advertised).length).toBeLessThan(1_100);
  });
});

const waitNames = (env: Record<string, string>) =>
  availableTools(catalogProfileFromEnv({ OMB_BOT_ID: "scout", OMB_CHIEF_OF_STAFF: "1", ...env })).map((tool) => tool.name).filter((name) => WAIT_TOOL_NAMES.has(name));

describe("which wait tools a turn is listed", () => {
  it("lists wait_until alone while the bot has no wait, and list_waits and cancel_wait too once it has one", () => {
    expect(waitNames({})).toEqual(["wait_until"]);
    expect(waitNames({ OMB_ACTIVE_WAITS: "1" })).toEqual(["wait_until", "list_waits", "cancel_wait"]);
    const all = availableTools(catalogProfileFromEnv({ OMB_BOT_ID: "scout", OMB_ACTIVE_WAITS: "1" })).map((tool) => tool.name);
    expect(availableTools(catalogProfileFromEnv({ OMB_BOT_ID: "scout" })).map((tool) => tool.name))
      .toEqual(all.filter((name) => name !== "list_waits" && name !== "cancel_wait"));
  });

  it("marks list_waits read-only when it is listed, and nothing else of the three", () => {
    const tools = availableTools(catalogProfileFromEnv({ OMB_BOT_ID: "scout", OMB_ACTIVE_WAITS: "1" })).filter((tool) => WAIT_TOOL_NAMES.has(tool.name));
    expect(tools.map((tool) => [tool.name, Boolean((tool as { annotations?: { readOnlyHint?: boolean } }).annotations?.readOnlyHint)]))
      .toEqual([["wait_until", false], ["list_waits", true], ["cancel_wait", false]]);
  });

  // OMB_ACTIVE_WAITS counts the chat's own waits (WaitManager.count), and no wait is made in a room, so a room's turn
  // is never listed list_waits in practice; the catalog would list it alone.
  it("lists a room's turn list_waits alone, and only with OMB_ACTIVE_WAITS", () => {
    expect(waitNames({ OMB_ROOM: "1" })).toEqual([]);
    expect(waitNames({ OMB_ROOM: "1", OMB_ACTIVE_WAITS: "1" })).toEqual(["list_waits"]);
  });

  it("lets a turn call list_waits and cancel_wait without a wait, but never what a room refuses", () => {
    const callable = (env: Record<string, string>) => callableTools(catalogProfileFromEnv({ OMB_BOT_ID: "scout", ...env }))
      .map((tool) => tool.name).filter((name) => WAIT_TOOL_NAMES.has(name));
    expect(callable({})).toEqual(["wait_until", "list_waits", "cancel_wait"]);
    expect(callable({ OMB_ROOM: "1" })).toEqual(["list_waits"]);
  });
});

describe("a wait tool the turn is not listed", () => {
  let server: Server;
  let url = "";
  const reached: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url?.startsWith("/api/internal/waits")) reached.push(`${req.method} ${req.url}`);
      const [status, body] = req.url === "/api/internal/waits/cancel"
        ? [404, { error: "None of your waits in this chat has that id. Use list_waits." }]
        : [200, { text: "You are not waiting for anything in this chat." }];
      req.resume();
      req.on("end", () => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const send = (env: Record<string, string>, method: string, params?: Json) =>
    agentsMcp({ OMB_BOT_ID: "scout", OMB_THREAD_ID: "t1", OMB_COMMS_TOKEN: "token", OMB_HARNESS_URL: url, ...env })(
      { jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) } as Json,
    ) as Promise<{ result?: { tools?: Array<{ name: string }>; content?: Array<{ text: string }>; isError?: boolean }; error?: { message: string } }>;
  const answer = async (env: Record<string, string>, name: string, args: Json = {}) => {
    const reply = await send(env, "tools/call", { name, arguments: args });
    return reply.error ? { error: reply.error.message } : { text: reply.result!.content![0]!.text, isError: reply.result!.isError };
  };

  it("still answers in the route's words when called directly, from a list read before or a wait made this turn", async () => {
    const listed = (await send({}, "tools/list")).result!.tools!.map((tool) => tool.name);
    expect(listed).toContain("wait_until");
    expect(listed).not.toContain("list_waits");
    expect(listed).not.toContain("cancel_wait");
    reached.length = 0;
    expect(await answer({}, "list_waits")).toEqual({ text: "You are not waiting for anything in this chat.", isError: false });
    expect(await answer({}, "cancel_wait", { id: "w1" })).toEqual({ text: "None of your waits in this chat has that id. Use list_waits.", isError: true });
    expect(reached).toEqual(["GET /api/internal/waits", "POST /api/internal/waits/cancel"]);
  });

  it("runs through use_tool on a bridged turn, which find_tool offers only once the bot has a wait", async () => {
    const bridged = { OMB_AGENTS_TOOL_BRIDGE: "1" };
    const found = async (env: Record<string, string>) =>
      (JSON.parse((await answer({ ...bridged, ...env }, "find_tool", { query: "cancel_wait" })).text!) as { matches: Array<{ name: string }> })
        .matches.map((match) => match.name);
    expect(await found({})).not.toContain("cancel_wait");
    expect(await found({ OMB_ACTIVE_WAITS: "1" })).toContain("cancel_wait");
    expect(await answer(bridged, "use_tool", { name: "cancel_wait", arguments: { id: "w1" } }))
      .toEqual({ text: "None of your waits in this chat has that id. Use list_waits.", isError: true });
    expect(await answer(bridged, "use_tool", { name: "list_waits" })).toEqual({ text: "You are not waiting for anything in this chat.", isError: false });
  });

  it("refuses cancel_wait in a room as a tool the room is not given, and still answers list_waits there", async () => {
    reached.length = 0;
    expect(await answer({ OMB_ROOM: "1" }, "cancel_wait", { id: "w1" })).toEqual({ error: "Unknown tool: cancel_wait" });
    expect(await answer({ OMB_ROOM: "1" }, "list_waits")).toEqual({ text: "You are not waiting for anything in this chat.", isError: false });
    expect(reached).toEqual(["GET /api/internal/waits"]);
  });
});
