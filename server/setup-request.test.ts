// Set me up: the press is answered by the server alone, and only the person's next line in that conversation runs as setup.
import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { askForSetup, cancelSetupRequest, openSetupOffer, setupCommandText, takeSetupRequest } from "./setup-request.ts";
import { Store, type Message } from "./store.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });
const LINE = "Great. Tell me what you'd like help with, in your own words, and I'll set myself up for it. For example: \"sort my inbox every morning\" or \"research our competitors every week\".";

function setup() {
  const store = new Store(selection, undefined, undefined, "en");
  const bot = store.createBot({ name: "Ava" });
  const threadId = bot.threadId;
  const say = (text: string, thread = threadId, extra: Partial<Message> = {}) =>
    store.appendMessage(thread, { role: "user", kind: "text", text, ...extra });
  const take = (line: Message, options: { person?: boolean; mounted?: boolean; editedFrom?: string; thread?: string } = {}) =>
    takeSetupRequest(store, { botId: bot.id, threadId: options.thread ?? threadId, line, person: options.person ?? true,
      mounted: options.mounted ?? true, ...(options.editedFrom ? { editedFrom: options.editedFrom } : {}) });
  const waiting = (thread = threadId) => store.taskByThread(bot.id, thread)?.setupRequest;
  return { store, bot, threadId, say, take, waiting };
}

beforeEach(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe("the Set me up offer", () => {
  it("is open on a blank bot's greeting until the bot is given a role, in no other conversation", () => {
    const s = setup();
    expect(openSetupOffer(s.store, s.bot.id, s.threadId)?.text).toBe("Hi, I'm Ava. What would you like me to do?");
    const other = s.store.createTask(s.bot.id, "Another chat", false)!;
    expect(openSetupOffer(s.store, s.bot.id, other.threadId)).toBeNull();
    s.store.patchBot(s.bot.id, { description: "Files bugs." });
    expect(openSetupOffer(s.store, s.bot.id, s.threadId)).toBeNull();
  });

  it("goes away with the person's first line, pressed or not", () => {
    const s = setup();
    expect(s.take(s.say("hello"))).toBe(false);
    expect(s.store.messagesFor(s.threadId)[0]?.setupOffer).toBeUndefined();
    expect(openSetupOffer(s.store, s.bot.id, s.threadId)).toBeNull();
  });

  it("stays when a routine or another bot writes first", () => {
    const s = setup();
    s.take(s.say("Run the daily check"), { person: false });
    s.take(s.say("A teammate asked you to review this", s.threadId, { peerAsk: { botId: "b2", name: "Kit" } }));
    expect(openSetupOffer(s.store, s.bot.id, s.threadId)).not.toBeNull();
  });
});

describe("pressing Set me up", () => {
  it("answers at once with the bot's own line, takes the button away and marks the conversation", () => {
    const s = setup();
    const pressed = askForSetup(s.store, s.bot.id, s.threadId, "en");
    expect(pressed).toMatchObject({ ok: true, message: { role: "bot", kind: "text", text: LINE } });
    const messages = s.store.messagesFor(s.threadId);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.setupOffer).toBeUndefined();
    expect(messages[1]).toMatchObject({ role: "bot", kind: "text", text: LINE });
    expect(s.waiting()).toEqual({ at: messages[1]!.at });
  });

  it("is kept across a restart, and a second press adds nothing", () => {
    const s = setup();
    askForSetup(s.store, s.bot.id, s.threadId, "en");
    const reloaded = new Store(selection, undefined, undefined, "en");
    expect(reloaded.taskByThread(s.bot.id, s.threadId)?.setupRequest).toEqual(expect.objectContaining({ at: expect.any(Number) }));
    expect(reloaded.messagesFor(s.threadId)[0]?.setupOffer).toBeUndefined();
    expect(askForSetup(reloaded, s.bot.id, s.threadId, "en")).toEqual({ ok: true, already: true });
    expect(reloaded.messagesFor(s.threadId)).toHaveLength(2);
  });

  it("is refused once the bot has a role or the person has written, and for a conversation it does not own", () => {
    const s = setup();
    s.store.patchBot(s.bot.id, { soul: "Only water the garden." });
    expect(askForSetup(s.store, s.bot.id, s.threadId, "en")).toMatchObject({ ok: false, status: 409 });
    const fresh = setup();
    fresh.take(fresh.say("hello"));
    expect(askForSetup(fresh.store, fresh.bot.id, fresh.threadId, "en")).toMatchObject({ ok: false, status: 409 });
    expect(askForSetup(fresh.store, fresh.bot.id, "not-a-thread", "en")).toMatchObject({ ok: false, status: 404 });
    expect(fresh.store.messagesFor(fresh.threadId).filter((message) => message.role === "bot")).toHaveLength(1);
  });

  it("speaks the app's language", () => {
    const s = setup();
    const pressed = askForSetup(s.store, s.bot.id, s.threadId, "pt-BR");
    expect(pressed.ok && "message" in pressed && pressed.message.text).toMatch(/^Ótimo\./);
  });
});

describe("the line after the press", () => {
  it("runs as a setup request and is marked so, while showing the person's own words; the mark clears", () => {
    const s = setup();
    askForSetup(s.store, s.bot.id, s.threadId, "en");
    const line = s.say("sort my inbox every morning");
    expect(s.take(line)).toBe(true);
    expect(s.store.messagesFor(s.threadId).find((message) => message.id === line.id)).toMatchObject({
      text: "sort my inbox every morning", setupRequest: true,
    });
    expect(s.waiting()).toBeUndefined();
    expect(s.take(s.say("and file the receipts"))).toBe(false);
  });

  it("is never a routine's, another bot's, or another conversation's", () => {
    const s = setup();
    askForSetup(s.store, s.bot.id, s.threadId, "en");
    expect(s.take(s.say("Run the daily check"), { person: false })).toBe(false);
    expect(s.take(s.say("Review this diff", s.threadId, { peerAsk: { botId: "b2", name: "Kit" } }))).toBe(false);
    expect(s.take(s.say("Relayed from Slack", s.threadId, { relayed: true }))).toBe(false);
    const other = s.store.createTask(s.bot.id, "Another chat", false)!;
    expect(s.take(s.say("hello", other.threadId), { thread: other.threadId })).toBe(false);
    expect(s.waiting()).toEqual(expect.objectContaining({ at: expect.any(Number) }));
    expect(s.take(s.say("sort my inbox"))).toBe(true);
  });

  it("clears on cancel, and the next line runs as typed", () => {
    const s = setup();
    askForSetup(s.store, s.bot.id, s.threadId, "en");
    expect(cancelSetupRequest(s.store, s.bot.id, s.threadId)).toBe(true);
    expect(s.waiting()).toBeUndefined();
    expect(s.take(s.say("sort my inbox"))).toBe(false);
    expect(cancelSetupRequest(s.store, s.bot.id, "not-a-thread")).toBe(false);
  });

  it("clears and runs as typed for a slash command, or on a model that cannot set itself up", () => {
    const s = setup();
    askForSetup(s.store, s.bot.id, s.threadId, "en");
    expect(s.take(s.say("/learn how I like reports"))).toBe(false);
    expect(s.waiting()).toBeUndefined();
    const t = setup();
    askForSetup(t.store, t.bot.id, t.threadId, "en");
    const line = t.say("sort my inbox");
    expect(t.take(line, { mounted: false })).toBe(false);
    expect(t.waiting()).toBeUndefined();
    expect(t.store.messagesFor(t.threadId).find((message) => message.id === line.id)?.setupRequest).toBeUndefined();
  });

  it("stays a setup request when it runs again: a retry on another model, a computer pick, or the person's edit", () => {
    const s = setup();
    askForSetup(s.store, s.bot.id, s.threadId, "en");
    const line = s.say("sort my inbox");
    s.take(line);
    const stored = s.store.messagesFor(s.threadId).find((message) => message.id === line.id)!;
    expect(s.take(stored, { person: false })).toBe(true);
    const edited = s.store.branchMessage(s.threadId, line.id, "sort my inbox and my calendar")!;
    expect(s.take(edited, { person: false, editedFrom: line.id })).toBe(true);
    expect(s.store.messagesFor(s.threadId).find((message) => message.id === edited.id)?.setupRequest).toBe(true);
    const plain = s.say("thanks");
    s.take(plain);
    const editedPlain = s.store.branchMessage(s.threadId, plain.id, "thank you")!;
    expect(s.take(editedPlain, { person: false, editedFrom: plain.id })).toBe(false);
  });
});

describe("setupCommandText", () => {
  it("reads the person's words as /setup with them", () => {
    expect(setupCommandText("sort my inbox every morning")).toBe("/setup sort my inbox every morning");
    expect(setupCommandText("/setup sort my inbox")).toBe("/setup sort my inbox");
  });
});
