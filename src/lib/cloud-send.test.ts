import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlanRow } from "../../electron/cloud-send-parts.mjs";
import type { CloudSendNotice, CloudSendSnapshot } from "../../electron/cloud-send.mjs";
import { setLocale } from "@/lib/i18n";
import { failedLine, moveLine, resultLines, sendStateLine, statusLine, stripLine } from "./cloud-send";

const row = (key: string, kind: PlanRow["kind"], label: string, state: PlanRow["state"], extra: Partial<PlanRow> = {}): PlanRow => ({ key, kind, label, state, ...extra });
const noneArrived = { bots: 0, updatedBots: 0, skills: 0, logins: 0, onePassword: false, settings: 0, chats: { conversations: 0, messages: 0 } };
const snapshot = (extra: Partial<CloudSendSnapshot> = {}): CloudSendSnapshot => ({
  cloud: "ready", running: null, pending: 0, chats: null, signature: "", dismissed: "", last: null, whole: null, arrived: noneArrived, cloudVersion: "0.1.117", localVersion: "0.1.117",
  rows: [
    row("bot:ember", "bot", "Ember", "only-here", { id: "ember" }),
    row("skill:ember:notes", "skill", "notes", "only-here", { bot: "ember" }),
    row("bot:juno", "bot", "Juno", "to-update", { id: "juno" }),
    row("login:github.com|amit", "login", "github.com", "only-here", { detail: "amit" }),
    row("login:bank.test|amit", "login", "bank.test", "on-both", { detail: "amit" }),
    row("1password", "1password", "1Password", "only-here"),
    row("setting:profile", "setting", "profile", "to-update"),
    row("setting:language", "setting", "language", "on-both"),
  ],
  cloudOnly: ["Miso", "Atlas", "Kit", "Lark", "Nova", "Pip", "Rune", "Sage", "Wren", "Yuki"].map((name) => ({ key: `bot:${name}`, kind: "bot" as const, label: name })),
  ...extra,
});
const notice = (extra: Partial<CloudSendNotice> = {}): CloudSendNotice => ({
  ready: true, bots: [], updatedBots: [], skills: 0, logins: 0, onePassword: false, settings: 0, signature: "s", dismissed: false, running: false, last: null, whole: null, ...extra,
});

beforeEach(() => { setLocale("en"); });
afterEach(() => { setLocale("en"); });

describe("This computer and My Cloud, in words", () => {
  it("says what is not on My Cloud yet, by kind and with the chats still to go; that all is there; or what is sending", () => {
    expect(sendStateLine(snapshot({ chats: { waiting: 12 } }), null)).toEqual({ kind: "waiting",
      text: "Not on My Cloud yet: 1 bot, changes to 1 bot, 1 login, 1Password, your settings, and 12 chats." });
    const done = snapshot({ rows: [row("bot:ember", "bot", "Ember", "on-both")], chats: { waiting: 0 } });
    expect(sendStateLine(done, null)).toEqual({ kind: "done", text: "Everything from this computer is on My Cloud." });
    expect(sendStateLine({ ...done, chats: { waiting: 1 } }, null).text).toBe("Not on My Cloud yet: 1 chat.");
    expect(sendStateLine(snapshot({ running: { reason: "move", progress: { done: 2, total: 9 } } }), null)).toEqual({ kind: "sending", text: "Sending to My Cloud… 2 of 9" });
  });

  it("says what a send did in one sentence, then what is worth knowing", () => {
    const sent = resultLines({ at: 1, reason: "button", result: { bots: ["Ember"], updatedBots: ["Juno"], skills: 2, logins: 1, onePassword: true, settings: ["profile"], chats: null, failed: [],
      notes: [{ kind: "model", bot: "Ember" }, { kind: "narrowed", login: "crm" }] } });
    expect(sent.text).toBe("Sent to My Cloud: Ember, changes to Juno, 2 skills, 1 login, 1Password, and your settings.");
    expect(sent.notes).toEqual([
      "Ember uses My Cloud's own AI: the one it uses here isn't set up on My Cloud.",
      "A login kept to bots that stay on this computer reaches no bot on My Cloud yet. Choose Who can use it in My Cloud's Settings → Logins.",
    ]);
    expect(resultLines({ at: 1, reason: "button", result: { bots: [], updatedBots: [], skills: 0, logins: 0, onePassword: false, settings: [], chats: null, failed: [], notes: [] } }).text)
      .toBe("My Cloud already has everything from this computer.");
    const failed = resultLines({ at: 1, reason: "button", result: { bots: [], updatedBots: [], skills: 0, logins: 0, onePassword: false, settings: [], chats: null, notes: [],
      failed: [{ key: "bot:ember", kind: "bot", label: "Ember", error: "this workspace is limited to 50 bots" }] } });
    expect(failed).toMatchObject({ failed: true, text: "Ember couldn't be sent: this workspace is limited to 50 bots" });
  });

  it("says what did not go by kind, with the first reason, and why a send stopped", () => {
    const none = { bots: [], updatedBots: [], skills: 0, logins: 0, onePassword: false, settings: [], chats: null, notes: [] };
    const partly = resultLines({ at: 1, reason: "my-cloud", result: { ...none, bots: ["Ember"], chats: { conversations: 48, messages: 900 }, failed: [
      { key: "login:a.test|amit", kind: "login", label: "a.test", error: "OpenMausBot on this computer did not answer. Try again." },
      { key: "login:b.test|amit", kind: "login", label: "b.test", error: "OpenMausBot on this computer did not answer. Try again." },
      { key: "1password", kind: "1password", label: "1Password", error: "1Password did not accept this computer's token on My Cloud." },
    ] } });
    expect(partly.text).toBe("Sent to My Cloud: Ember and 48 chats. 2 logins couldn't be sent: OpenMausBot on this computer did not answer. Try again. "
      + "1Password couldn't be sent: 1Password did not accept this computer's token on My Cloud.");
    expect(partly.text).not.toContain("a.test");
    expect(resultLines({ at: 1, reason: "button", result: { ...none, chats: { conversations: 0, messages: 7 }, failed: [] } }).text).toBe("Sent to My Cloud: 7 new messages.");
    expect(resultLines({ at: 1, reason: "button", result: { ...none, bots: Array.from({ length: 12 }, (_, i) => `Bot ${i}`), skills: 3, chats: { conversations: 48, messages: 900 }, failed: [] } }).text)
      .toBe("Sent to My Cloud: 12 bots, 3 skills, and 48 chats.");
    expect(resultLines({ at: 1, reason: "button", error: "This app could not sign in to My Cloud. Try again.", result: { ...none, failed: [] } }))
      .toMatchObject({ failed: true, text: "Send to My Cloud stopped: This app could not sign in to My Cloud. Try again." });
    const nothing = { bots: [], skills: 0, logins: 0, onePassword: false, settings: 0, chats: false };
    expect(failedLine({ reasons: [{ what: { ...nothing, chats: true }, error: "My Cloud is busy." }] })).toBe("The chats couldn't be sent: My Cloud is busy.");
    expect(failedLine({ reasons: [{ what: { ...nothing, bots: ["A", "B", "C", "D", "E"] }, error: "this workspace is limited to 100 bots" }] }))
      .toBe("5 bots couldn't be sent: this workspace is limited to 100 bots");
    expect(failedLine({})).toBeNull();
  });

  it("names My Cloud's version, says when it is older, and why it can't compare", () => {
    expect(statusLine(snapshot(), false)).toEqual({ text: "My Cloud is online · version 0.1.117", tone: "status" });
    expect(statusLine(snapshot({ cloudVersion: "0.1.116" }), false)?.text).toBe("My Cloud runs 0.1.116 and this computer runs 0.1.117. My Cloud updates by itself.");
    expect(statusLine(snapshot({ cloud: "outdated" }), false)?.text).toContain("My Cloud needs an update");
    expect(statusLine(snapshot({ cloud: "asleep" }), false)?.text).toContain("asleep");
    expect(statusLine(snapshot({ cloud: "unreachable" }), true)?.text).toBe("Comparing this computer and My Cloud…");
    expect(statusLine(snapshot({ cloud: "none" }), false)).toBeNull();
  });
});

describe("My Cloud's strip", () => {
  const counts = { bots: 0, updatedBots: 0, skills: 0, logins: 0, onePassword: false, settings: 0, chats: null };
  it("shows the move arriving, then what came; nothing for a send from this computer's Settings that went well", () => {
    expect(stripLine(notice({ running: true, runningReason: "move", progress: { done: 2, total: 9 }, phase: "chats" }), false, null))
      .toEqual({ kind: "sending", text: "Bringing this computer's chats here… 2 of 9" });
    expect(stripLine(notice({ running: true, runningReason: "button" }), false, null)).toBeNull();
    expect(stripLine(notice({ running: true, runningReason: "first" }), false, null)?.kind, "an older desktop's first send by itself").toBe("sending");
    expect(stripLine(notice({ last: { at: 1, reason: "first", failed: 0, seen: false, sent: { ...counts, bots: 2 } } }), false, null)?.text).toBe("2 bots came over from This computer.");
    expect(stripLine(notice({ last: { at: 1, reason: "move", failed: 0, seen: false, sent: { ...counts, bots: 1, chats: { conversations: 0, messages: 7 } } } }), false, null))
      .toEqual({ kind: "done", text: "1 bot and 7 new messages came over from This computer." });
    expect(stripLine(notice({ last: { at: 1, reason: "move", failed: 0, seen: false, sent: counts } }), false, null)?.text).toBe("Everything from This computer is here.");
    expect(stripLine(notice({ last: { at: 1, reason: "move", failed: 0, seen: true, sent: counts } }), false, null)).toBeNull();
    expect(stripLine(notice({ last: { at: 1, reason: "button", failed: 0, seen: false, sent: { ...counts, bots: 2 } } }), false, null)).toBeNull();
    expect(stripLine(notice(), true, null)?.kind).toBe("sending");
    expect(stripLine(notice(), false, "My Cloud is asleep.")).toEqual({ kind: "failed", text: "Send to My Cloud stopped: My Cloud is asleep." });
  });

  it("names apps and keys a move could not carry, by count", () => {
    const nothing = { bots: [], skills: 0, logins: 0, onePassword: false, settings: 0, chats: false };
    expect(failedLine({ reasons: [{ what: { ...nothing, connections: 2 }, error: "My Cloud said: no such engine" }] })).toBe("2 apps and keys couldn't be sent: My Cloud said: no such engine");
    expect(resultLines({ at: 1, reason: "move", result: { bots: ["Ember"], updatedBots: [], skills: 0, logins: 0, onePassword: false, settings: [], connections: 1, chats: null, failed: [], notes: [] } }).text)
      .toBe("Sent to My Cloud: Ember and 1 app or key.");
  });
});

describe("the one-time move's line", () => {
  it("says where the move is on whichever page is open, and who it waits for", () => {
    expect(moveLine({ phase: "copy" }, "local")).toMatchObject({ kind: "sending", text: "Moving your bots to My Cloud…" });
    expect(moveLine({ phase: "copy", chats: { done: 34, total: 120 } }, "local")?.text).toBe("Moving your bots to My Cloud… 34 of 120 chats");
    expect(moveLine({ phase: "copy", chats: { done: 34, total: 120 } }, "cloud")?.text).toBe("Bringing this computer's bots to My Cloud… 34 of 120 chats");
    expect(moveLine({ phase: "wait", waitingFor: "Scout" }, "local")?.text).toBe("Moving your bots to My Cloud… waiting for Scout to finish");
    expect(moveLine({ phase: "wait", waitingFor: "" }, "local")?.text).toBe("Moving your bots to My Cloud… waiting for your bots to finish");
    expect(moveLine({ phase: "finishing" }, "cloud")).toMatchObject({ kind: "sending", text: "Moving to My Cloud… almost done" });
  });

  it("after a day of failing says why, with Try again", () => {
    expect(moveLine({ phase: "copy", failing: { error: "My Cloud did not answer." } }, "local")).toMatchObject({ kind: "failed", text: "Your bots couldn't move to My Cloud yet: My Cloud did not answer.", retry: true });
    expect(moveLine({ phase: "finishing", failing: { error: null } }, "local")?.text).toBe("Your bots couldn't move to My Cloud yet.");
  });

  it("says once on My Cloud's page what arrived, a key kept for after the trial, and the phone to pair; on this computer, coming home", () => {
    const done = moveLine({ phase: "done", counts: { bots: 4, skills: 2, logins: 2, onePassword: true, chats: 148, routines: 2 }, phone: true, held: ["OpenRouter"] }, "cloud");
    expect(done).toMatchObject({ kind: "done", text: "Everything from this computer is here: 4 bots, 2 skills, 2 logins, 1Password, 148 chats, and 2 routines.", phone: true,
      extra: ["Your OpenRouter key is saved on My Cloud. Your bots use it once the trial's Claude credit runs out."] });
    expect(moveLine({ phase: "done", phone: false, held: [] }, "cloud")).toMatchObject({ text: "Everything from this computer is here.", extra: [] });
    expect(moveLine({ phase: "done", phone: true, held: [] }, "local"), "the done line is My Cloud's").toBeNull();
    expect(moveLine({ phase: "home-again" }, "local")?.text).toContain("your bots are back on this computer");
    expect(moveLine({ phase: "back", lost: true }, "local")?.text).toContain("couldn't come back");
    expect(moveLine({ phase: "back" }, "cloud")).toBeNull();
  });

  it("is in every language's own words", () => {
    setLocale("de");
    expect(moveLine({ phase: "copy" }, "local")?.text).toBe("Deine Bots ziehen in die Cloud um…");
  });
});
