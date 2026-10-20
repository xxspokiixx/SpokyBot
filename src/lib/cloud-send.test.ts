import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlanRow } from "../../electron/cloud-send-parts.mjs";
import type { CloudSendNotice, CloudSendSnapshot } from "../../electron/cloud-send.mjs";
import { setLocale } from "@/lib/i18n";
import { detailRows, failedLine, noticeLine, resultLines, sideLines, statusLine } from "./cloud-send";

const row = (key: string, kind: PlanRow["kind"], label: string, state: PlanRow["state"], extra: Partial<PlanRow> = {}): PlanRow => ({ key, kind, label, state, ...extra });
const snapshot = (extra: Partial<CloudSendSnapshot> = {}): CloudSendSnapshot => ({
  cloud: "ready", auto: true, running: null, pending: 0, signature: "", dismissed: "", last: null, cloudVersion: "0.1.117", localVersion: "0.1.117",
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
  ready: true, bots: [], updatedBots: [], skills: 0, logins: 0, onePassword: false, settings: 0, signature: "s", dismissed: false, running: false, last: null, ...extra,
});

beforeEach(() => { setLocale("en"); });
afterEach(() => { setLocale("en"); });

describe("This computer and My Cloud, in words", () => {
  it("counts each kind on both sides and says how they differ: bots by name, logins by count, 1Password named", () => {
    const lines = Object.fromEntries(sideLines(snapshot()).map((line) => [line.kind, line]));
    expect(lines.bots).toMatchObject({ here: 2, cloud: 11, waiting: true, difference: "Ember only here · Juno newer here · Miso and 9 more only on My Cloud" });
    expect(lines.skills).toMatchObject({ here: 1, cloud: 0, difference: "notes only here" });
    expect(lines.logins).toMatchObject({ here: 3, cloud: 1, difference: "1 login and 1Password only here" });
    expect(lines.settings).toMatchObject({ waiting: true, difference: "Your name and About me newer here" });
    const same = sideLines(snapshot({ rows: [row("bot:ember", "bot", "Ember", "on-both")], cloudOnly: [] }));
    expect(same.map((line) => line.difference)).toEqual(["Same on both", "Same on both", "Same on both", "Same on both"]);
    expect(sideLines(snapshot({ rows: [row("bot:ember", "bot", "Ember", "differs")], cloudOnly: [] }))[0]!.difference).toBe("1 different on My Cloud");
  });

  it("says what a send did in one sentence, then what is worth knowing", () => {
    const sent = resultLines({ at: 1, reason: "button", result: { bots: ["Ember"], updatedBots: ["Juno"], skills: 2, logins: 1, onePassword: true, settings: ["profile"], chats: null, failed: [],
      notes: [{ kind: "model", bot: "Ember" }, { kind: "narrowed", login: "crm" }] } });
    expect(sent.text).toBe("Sent to My Cloud: Ember, changes to Juno, 2 skills, 1 login, 1Password, and your settings.");
    expect(sent.notes).toEqual([
      "Ember uses My Cloud's own engine: the one it uses here isn't set up on My Cloud.",
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

  it("puts each bot's skills under it, then logins, then settings", () => {
    expect(detailRows(snapshot().rows).map((entry) => entry.key)).toEqual([
      "bot:ember", "skill:ember:notes", "bot:juno", "login:github.com|amit", "login:bank.test|amit", "1password", "setting:profile", "setting:language",
    ]);
  });
});

describe("My Cloud's strip", () => {
  it("says what this computer has that My Cloud lacks, in one line, and nothing when nothing waits", () => {
    expect(noticeLine(notice({ bots: ["Ember"], skills: 2, onePassword: true }))).toEqual({ text: "Ember, 2 skills, and 1Password are on This computer but not here.", one: false });
    expect(noticeLine(notice({ bots: ["Ember"] }))).toEqual({ text: "Ember is on This computer but not here.", one: true });
    expect(noticeLine(notice({ logins: 1 }))).toEqual({ text: "1 login is on This computer but not here.", one: true });
    expect(noticeLine(notice({ updatedBots: ["Ember"], settings: 1 }))).toEqual({ text: "This computer has changes to Ember and your settings.", one: false });
    expect(noticeLine(notice())).toBeNull();
  });
});
