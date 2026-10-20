import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDraft, restoreComposerDraft } from "@/lib/drafts";
import { setLocale, t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { addBot, addBotChief } from "./add-bot";

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name: id, title: "", description: "", notifications: true,
  color: "green", unread: false, modelSelection: { instanceId: "fake", model: "m" }, messages: [], ...extra,
});
const draft = (id: string) => getDraft(undefined, id);
const actions = (dispatch: ReturnType<typeof vi.fn>) => dispatch.mock.calls.map(([action]) => action);

beforeEach(() => {
  setLocale("en");
  for (const id of ["bot:chief:chief-thread", "bot:chief:main"]) restoreComposerDraft(id, { text: "", attachments: [] });
});

describe("adding a bot", () => {
  it("in Simple mode hands the job to the Chief: its chat opens with a starter to send, and no form", () => {
    const dispatch = vi.fn();
    const chief = bot("chief", { chiefOfStaff: true });
    addBot(dispatch, [bot("helper"), chief], true, false);
    expect(actions(dispatch)).toEqual([{ type: "select", id: "chief" }]);
    expect(draft("bot:chief:chief-thread")).toBe(t("chief.addBotStarter"));
    addBot(dispatch, [chief], true, false);
    expect(draft("bot:chief:chief-thread"), "asking twice does not stack the starter").toBe(t("chief.addBotStarter"));
  });

  it("puts the starter in the conversation the Chief opens to, ahead of what the person had typed there", () => {
    const dispatch = vi.fn();
    const chief = bot("chief", { chiefOfStaff: true, threadId: "older", mainThreadId: "main", tasks: [{ threadId: "older", title: "Older", createdAt: 1 }, { threadId: "main", title: "Main", createdAt: 2 }] });
    restoreComposerDraft("bot:chief:main", { text: "and it should read my invoices", attachments: [] });
    addBot(dispatch, [chief], false, false);
    expect(actions(dispatch)).toEqual([{ type: "switchTask", botId: "chief", threadId: "main" }]);
    expect(draft("bot:chief:main")).toBe(`${t("chief.addBotStarter")}\n\nand it should read my invoices`);
  });

  it("opens the New bot form in Advanced mode, and in Simple mode when there is no Chief to ask", () => {
    for (const [bots, advanced] of [[[bot("chief", { chiefOfStaff: true })], true], [[bot("helper")], false], [[bot("gone", { chiefOfStaff: true, hidden: true })], false]] as const) {
      const dispatch = vi.fn();
      addBot(dispatch, bots, true, advanced);
      expect(actions(dispatch)).toEqual([{ type: "toggleNewBot", open: true }]);
    }
    expect(draft("bot:chief:chief-thread")).toBe("");
  });

  it("asks General's Chief before a team's", () => {
    const team = bot("team-chief", { chiefOfStaff: true, section: "Sales" });
    const general = bot("general-chief", { chiefOfStaff: true });
    expect(addBotChief([team, general])?.id).toBe("general-chief");
    expect(addBotChief([team])?.id).toBe("team-chief");
    expect(addBotChief([bot("helper")])).toBeUndefined();
  });
});
