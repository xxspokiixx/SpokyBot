import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";
import { SetupOffer, SetupRequestChip, setupRequestPlaceholder } from "./SetupOffer";

const fixture = vi.hoisted(() => ({ values: [] as unknown[], index: 0, api: vi.fn(), focus: vi.fn(), bots: [] as unknown[] }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = initial;
    return [fixture.values[index], (next: unknown) => { fixture.values[index] = next; }];
  },
}));
vi.mock("@/state/store", () => ({ api: fixture.api, useStore: () => ({ state: { bots: fixture.bots }, dispatch: vi.fn() }) }));
vi.mock("./AskCard", async (original) => ({ ...await original<typeof import("./AskCard")>(), returnFocusToComposer: fixture.focus }));

type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
const nodes = (value: ReactNode): Node[] => Children.toArray(value).flatMap((child) => (isValidElement(child) ? [child as Node, ...nodes((child as Node).props.children)] : []));

const greeting: Message = { id: "g1", role: "bot", kind: "text", at: 1, text: "Hi, I'm Ava. What would you like me to do?", setupOffer: true } as Message;
const bot = (extra: Partial<Bot> = {}): Bot => ({ id: "b1", threadId: "t1", name: "Ava", title: "", description: "", soul: "", tasks: [{ threadId: "t1", title: "New thread", createdAt: 1 }], ...extra }) as Bot;

function renderOffer(message: Message, transcript: Message[] = [message]) {
  let tree: ReactNode = null;
  function Capture() { fixture.index = 0; tree = SetupOffer({ botId: "b1", threadId: "t1", message, transcript }); return tree; }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, button: nodes(tree).find((node) => node.props["data-setup-offer"] !== undefined) };
}

function renderChip(of: Bot) {
  let tree: ReactNode = null;
  function Capture() { fixture.index = 0; tree = SetupRequestChip({ bot: of, threadId: "t1" }); return tree; }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, close: nodes(tree).find((node) => node.props["data-setup-request-cancel"] !== undefined) };
}

beforeEach(() => {
  fixture.values = [];
  fixture.api.mockReset().mockResolvedValue({ ok: true });
  fixture.focus.mockReset();
  fixture.bots = [bot()];
});

describe("Set me up under a new bot's greeting", () => {
  it("shows under a blank bot's greeting", () => {
    const view = renderOffer(greeting);
    expect(view.html).toContain("Set me up");
    expect(view.button).toBeDefined();
  });

  it("is not shown for a bot given a role or instructions, after the person wrote, or once it is pressed", () => {
    fixture.bots = [bot({ soul: "Only water the garden." })];
    expect(renderOffer(greeting).button).toBeUndefined();
    fixture.bots = [bot({ description: "Files bugs." })];
    expect(renderOffer(greeting).button).toBeUndefined();
    fixture.bots = [bot()];
    const said = { id: "u1", role: "user", kind: "text", at: 2, text: "hello" } as Message;
    expect(renderOffer(greeting, [greeting, said]).button).toBeUndefined();
    expect(renderOffer({ ...greeting, setupOffer: undefined } as Message).html).toBe("");
  });

  it("asks the server once and puts the cursor in the message box", async () => {
    const view = renderOffer(greeting);
    (view.button!.props.onClick as () => void)();
    (view.button!.props.onClick as () => void)();
    await Promise.resolve();
    await Promise.resolve();
    expect(fixture.api).toHaveBeenCalledTimes(1);
    expect(fixture.api).toHaveBeenCalledWith("/api/bots/b1/setup-request", { method: "POST", body: JSON.stringify({ threadId: "t1" }) });
    expect(fixture.focus).toHaveBeenCalled();
  });

  it("says why when the press is refused", async () => {
    fixture.api.mockRejectedValue(new Error("This bot is already set up."));
    const view = renderOffer(greeting);
    (view.button!.props.onClick as () => void)();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(renderOffer(greeting).html).toContain("This bot is already set up.");
  });
});

describe("while the bot waits for what to set itself up for", () => {
  const waiting = bot({ tasks: [{ threadId: "t1", title: "New thread", createdAt: 1, setupRequest: { at: 2 } }] });

  it("says so above the message box, with an x that stops it", async () => {
    const chip = renderChip(waiting);
    expect(chip.html).toContain("Setting up Ava");
    (chip.close!.props.onClick as () => void)();
    await Promise.resolve();
    expect(fixture.api).toHaveBeenCalledWith("/api/bots/b1/setup-request", { method: "DELETE", body: JSON.stringify({ threadId: "t1" }) });
  });

  it("asks for the job in the message box", () => {
    expect(setupRequestPlaceholder(waiting, "t1")).toBe("Tell Ava what you'd like help with");
  });

  it("shows nothing in a conversation that is not waiting", () => {
    expect(renderChip(bot()).html).toBe("");
    expect(setupRequestPlaceholder(bot(), "t1")).toBeUndefined();
    expect(setupRequestPlaceholder(waiting, "t2")).toBeUndefined();
    expect(setupRequestPlaceholder(undefined, "t1")).toBeUndefined();
  });
});
