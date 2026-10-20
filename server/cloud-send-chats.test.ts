import { describe, expect, it } from "vitest";
import { addSentChats } from "./cloud-chat-merge.ts";
import { chatHeads, CHAT_ROWS_PAGE } from "./cloud-send-chats.ts";
import { DATA_DIR } from "./config.ts";
import { deleteThread, threadHeads, threadRowsAfter } from "./message-db.ts";
import { Store, type Message } from "./store.ts";

const fresh = () => new Store(() => ({ instanceId: "fixture", model: "fixture-model" }));
const say = (store: Store, threadId: string, text: string, at: number) => store.appendMessage(threadId, { role: "user", kind: "text", text, at });

describe("this computer's chats, by row", () => {
  it("lists each bot conversation's newest row, and hands the rows after a point a page at a time", () => {
    const store = fresh();
    const bot = store.createBot({ name: "Ava" }, { seedMessages: false });
    const lines = Array.from({ length: CHAT_ROWS_PAGE + 5 }, (_, i) => say(store, bot.threadId, `line ${i}`, 10 + i));
    const head = chatHeads(store.bots).find((entry) => entry.threadId === bot.threadId)!;
    expect(head).toMatchObject({ bot: bot.id, lastId: lines.at(-1)!.id, busy: false });

    const first = threadRowsAfter(bot.threadId, 0, null, CHAT_ROWS_PAGE);
    expect(first).toMatchObject({ more: true, restarted: false, lastId: lines[CHAT_ROWS_PAGE - 1]!.id });
    expect(first.rows).toHaveLength(CHAT_ROWS_PAGE);
    const second = threadRowsAfter(bot.threadId, first.last, first.lastId, CHAT_ROWS_PAGE);
    expect(second.rows.map((row) => row.id)).toEqual(lines.slice(CHAT_ROWS_PAGE).map((row) => row.id));
    expect(second).toMatchObject({ more: false, last: head.last, lastId: head.lastId });
    // Caught up: nothing, and the same point back.
    expect(threadRowsAfter(bot.threadId, head.last, head.lastId, CHAT_ROWS_PAGE)).toMatchObject({ rows: [], last: head.last, lastId: head.lastId, more: false });
  });

  it("starts a conversation over when the row it stopped at is gone, since that row's number can be given out again", () => {
    const store = fresh();
    const bot = store.createBot({ name: "Ava" }, { seedMessages: false });
    say(store, bot.threadId, "one", 1);
    const page = threadRowsAfter(bot.threadId, 0, null, CHAT_ROWS_PAGE);
    deleteThread(bot.threadId);
    const again = say(store, bot.threadId, "two", 2);
    const after = threadRowsAfter(bot.threadId, page.last, page.lastId, CHAT_ROWS_PAGE);
    expect(after).toMatchObject({ restarted: true, more: false });
    expect(after.rows.map((row) => row.id)).toEqual([again.id]);
    expect(threadHeads().get(bot.threadId)?.lastId).toBe(again.id);
  });
});

describe("on My Cloud", () => {
  it("skips a conversation whose bot is not there or is answering in it, never brings back one removed there, and adds the rest once", () => {
    const store = fresh();
    const ava = store.createBot({ name: "Ava" }, { seedMessages: false });
    const row = (id: string, at: number, parentId: string | null): Message => ({ id, at, parentId, role: "user", kind: "text", text: id });
    const none = addSentChats(store, DATA_DIR, "/elsewhere/.openmausbot", [
      { bot: "not-here", threadId: "t-nobody", task: null, rows: [row("x1", 1, null)], leaf: "x1", sent: false },
      { bot: ava.id, threadId: ava.threadId, task: null, rows: [row("a1", 1, null)], leaf: "a1", sent: false },
      { bot: ava.id, threadId: "t-gone", task: { threadId: "t-gone", title: "Gone", createdAt: 1, resumeCursors: {} }, rows: [row("g2", 5, "g1")], leaf: "g2", sent: true },
    ], { busy: (threadId) => threadId === ava.threadId });
    expect(none).toEqual({ conversations: 0, messages: 0, accepted: [], waiting: ["t-nobody", ava.threadId], removed: ["t-gone"] });
    expect(store.messagesFor(ava.threadId)).toEqual([]);
    expect(store.messagesFor("t-gone")).toEqual([]);

    // A conversation My Cloud lacks and never had arrives whole, with only what a conversation is.
    const added = addSentChats(store, DATA_DIR, "/elsewhere/.openmausbot", [
      { bot: ava.id, threadId: "t-new", task: { threadId: "t-new", title: "Plans", createdAt: 1, resumeCursors: { claude: "session" }, busy: true } as never,
        rows: [row("n1", 1, null), row("n2", 2, "n1")], leaf: "n2", sent: false },
      { bot: ava.id, threadId: ava.threadId, task: null, rows: [row("a1", 3, null)], leaf: "a1", sent: false },
    ], { busy: () => false });
    expect(added).toEqual({ conversations: 1, messages: 3, accepted: ["t-new", ava.threadId], waiting: [], removed: [] });
    expect(store.bot(ava.id)!.tasks!.find((task) => task.threadId === "t-new")).toMatchObject({ title: "Plans", resumeCursors: {} });
    // The next rows of both, alone: added after what is there, nothing twice.
    const next = addSentChats(store, DATA_DIR, "/elsewhere/.openmausbot", [
      { bot: ava.id, threadId: "t-new", task: null, rows: [row("n3", 4, "n2")], leaf: "n3", sent: true },
      { bot: ava.id, threadId: ava.threadId, task: null, rows: [row("a1", 3, null), row("a2", 5, "a1")], leaf: "a2", sent: true },
    ], { busy: () => false });
    expect(next).toMatchObject({ messages: 2, accepted: ["t-new", ava.threadId] });
    expect(store.messagesFor("t-new").map((entry) => entry.id)).toEqual(["n1", "n2", "n3"]);
    expect(store.messagesFor(ava.threadId).map((entry) => entry.id)).toEqual(["a1", "a2"]);
  });
});
