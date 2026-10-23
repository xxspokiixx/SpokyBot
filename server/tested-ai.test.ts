import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ModelSelection, ProviderSnapshot } from "./contracts.ts";
import { selectDefaultModelSelection, type SelectableInstance } from "./default-model-selection.ts";
import type { CheckableEngine } from "./engine-check.ts";
import { backgroundAiChecks, createTestedAi, type TestedAiDeps } from "./tested-ai.ts";

type Message = { role: string };
type Task = { threadId: string; modelSelection?: ModelSelection };
type Bot = { id: string; chiefOfStaff?: boolean; modelSelection: ModelSelection; tasks: Task[] };

const ready = (instanceId: string, driverKind: string, snapshot: Partial<ProviderSnapshot> = {}): SelectableInstance => ({
  instanceId, driverKind, snapshot: { state: "available", authenticated: true, ...snapshot },
  models: { default: `${instanceId}-model`, options: [{ id: `${instanceId}-model`, label: instanceId }] },
});
const on = (instanceId: string): ModelSelection => ({ instanceId, model: `${instanceId}-model` });

describe("testing an AI with one tiny message before a new bot's default trusts it", () => {
  let instances: SelectableInstance[];
  let answers: Record<string, () => Promise<string>>;
  let engines: Map<string, CheckableEngine>;
  let bots: Bot[];
  let messages: Map<string, Message[]>;
  let saved: ModelSelection | undefined;
  let pick: ModelSelection;
  let busy: Set<string>;
  let tested: ReturnType<typeof createTestedAi>;

  const engineFor = (instanceId: string): CheckableEngine => {
    let engine = engines.get(instanceId);
    if (!engine) {
      engine = { instanceId, displayName: instanceId, driverKind: instanceId, generateText: vi.fn(() => answers[instanceId]!()) };
      engines.set(instanceId, engine);
    }
    return engine;
  };
  // What server/index.ts does on every read of the engines: choose, then let the tests settle the choice.
  const refresh = () => {
    pick = tested.settle(selectDefaultModelSelection(instances, saved, { answered: tested.answered }), instances);
  };
  const make = (extra: Partial<TestedAiDeps> = {}) => createTestedAi({
    engine: (instanceId) => engineFor(instanceId),
    fixed: () => Boolean(saved),
    context: {},
    store: () => ({
      get bots() { return bots; },
      tasks: (botId: string) => bots.find((bot) => bot.id === botId)!.tasks,
      messagesFor: (threadId: string) => messages.get(threadId) ?? [],
      applyModelDefault: vi.fn((botId: string, selection: ModelSelection) => {
        const bot = bots.find((candidate) => candidate.id === botId)!;
        bot.modelSelection = structuredClone(selection);
        return bot;
      }),
    }) as unknown as ReturnType<TestedAiDeps["store"]>,
    threadBusy: (botId, threadId) => busy.has(`${botId}/${threadId}`),
    forBot: (selection) => ({ ...selection, effort: "high" }),
    changed: () => refresh(),
    background: true,
    ...extra,
  });
  const settled = () => vi.waitFor(() => expect(tested.testing()).toBe(false));
  const seeded = () => bots.find((bot) => bot.id === "chief")!;

  beforeEach(() => {
    instances = [ready("grok", "grokAgent"), ready("claude", "claudeAgent")];
    answers = { claude: async () => "OK", grok: async () => "OK" };
    engines = new Map();
    messages = new Map();
    saved = undefined;
    busy = new Set();
    bots = [{ id: "chief", chiefOfStaff: true, modelSelection: on("claude"), tasks: [{ threadId: "chief-main" }] }];
    tested = make();
  });
  afterEach(() => vi.useRealTimers());

  it("picks by ranking at once, tests the pick in the background, and keeps it when it answers", async () => {
    refresh();
    expect(pick).toEqual(on("claude"));
    expect(tested.state(instances[1]!)).toBe("testing");
    await settled();
    expect(tested.state(instances[1]!)).toBe("passed");
    expect(engines.get("claude")!.generateText).toHaveBeenCalledOnce();
    // Nothing else needs a test once the best AI answered.
    expect(engines.has("grok")).toBe(false);
    expect(pick).toEqual(on("claude"));
  });

  it("moves the default from a pick that didn't answer to the best AI that did, and the untouched first bot with it", async () => {
    answers.claude = async () => { throw new Error("socket hang up"); };
    refresh();
    await settled();
    expect(tested.state(instances[1]!)).toBe("failed");
    expect(tested.state(instances[0]!)).toBe("passed");
    expect(pick).toEqual(on("grok"));
    expect(seeded().modelSelection).toEqual({ ...on("grok"), effort: "high" });
  });

  it("never moves a saved default, and tests nothing for it", async () => {
    saved = on("claude");
    answers.claude = async () => { throw new Error("socket hang up"); };
    refresh();
    await settled();
    expect(pick).toEqual(on("claude"));
    expect(seeded().modelSelection).toEqual(on("claude"));
    expect(engines.size).toBe(0);
  });

  it("never moves a bot the person has written to, set up, or that is busy", async () => {
    answers.claude = async () => { throw new Error("socket hang up"); };
    bots.push(
      { id: "spoken", chiefOfStaff: true, modelSelection: on("claude"), tasks: [{ threadId: "spoken-main" }] },
      { id: "pinned", chiefOfStaff: true, modelSelection: on("claude"), tasks: [{ threadId: "pinned-main", modelSelection: on("claude") }] },
      { id: "working", chiefOfStaff: true, modelSelection: on("claude"), tasks: [{ threadId: "working-main" }] },
      { id: "made", modelSelection: on("claude"), tasks: [{ threadId: "made-main" }] },
    );
    messages.set("spoken-main", [{ role: "bot" }, { role: "user" }]);
    messages.set("chief-main", [{ role: "bot" }]);
    busy.add("working/working-main");
    refresh();
    await settled();
    expect(pick).toEqual(on("grok"));
    expect(seeded().modelSelection.instanceId).toBe("grok");
    for (const id of ["spoken", "pinned", "working", "made"]) expect(bots.find((bot) => bot.id === id)!.modelSelection).toEqual(on("claude"));
  });

  it("counts a test that hangs past its time as failed, and holds nothing open", async () => {
    vi.useFakeTimers();
    tested = make({ timeoutMs: 30_000 });
    answers.claude = () => new Promise<string>(() => {});
    refresh();
    expect(tested.state(instances[1]!)).toBe("testing");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(tested.state(instances[1]!)).toBe("failed");
    expect(pick).toEqual(on("grok"));
    expect(tested.testing()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("forgets a result when that AI's sign-in changes, and tests it again", async () => {
    answers.claude = async () => { throw new Error("Not logged in"); };
    refresh();
    await settled();
    expect(pick).toEqual(on("grok"));
    answers.claude = async () => "OK";
    instances = [instances[0]!, ready("claude", "claudeAgent", { account: { email: "person@example.test" } })];
    expect(tested.state(instances[1]!)).toBeUndefined();
    refresh();
    await settled();
    expect(tested.state(instances[1]!)).toBe("passed");
    expect(pick).toEqual(on("claude"));
  });

  it("checks one AI on request, sharing a test already under way, and live every other time", async () => {
    const live = { ...engineFor("claude"), snapshot: async () => instances[1]!.snapshot };
    refresh();
    const asked = tested.check(live);
    await expect(asked).resolves.toEqual({ ok: true });
    expect(engines.get("claude")!.generateText).toHaveBeenCalledOnce();
    expect(tested.info(instances[1]!)).toEqual({ aiTest: "passed" });
    expect(tested.info(instances[0]!)).toEqual({});
    // Setup's check is live: a sign-out the last status read hasn't seen yet still shows.
    answers.claude = async () => { throw new Error("Not logged in"); };
    await expect(tested.check(live)).resolves.toMatchObject({ ok: false });
    expect(tested.state(instances[1]!)).toBe("failed");
  });

  it("sends nothing in the background where it is switched off, and still checks on request", async () => {
    tested = make({ background: false });
    refresh();
    expect(tested.testing()).toBe(false);
    expect(engines.size).toBe(0);
    await expect(tested.check({ ...engineFor("grok"), snapshot: async () => instances[0]!.snapshot })).resolves.toEqual({ ok: true });
  });

  it("checks again on request after a failure, so Test again works", async () => {
    answers.claude = async () => { throw new Error("socket hang up"); };
    const live = { ...engineFor("claude"), snapshot: async () => instances[1]!.snapshot };
    await expect(tested.check(live)).resolves.toMatchObject({ ok: false });
    answers.claude = async () => "OK";
    await expect(tested.check(live)).resolves.toEqual({ ok: true });
    expect(tested.state(instances[1]!)).toBe("passed");
  });
});

describe("test messages in the background", () => {
  it("are on unless OMB_AI_CHECKS=0, and under vitest only when a test asks for them, so fake engines log only the turns a test sends", () => {
    expect(backgroundAiChecks({})).toBe(true);
    expect(backgroundAiChecks({ OMB_AI_CHECKS: "0" })).toBe(false);
    expect(backgroundAiChecks({ OMB_AI_CHECKS: " 0 " })).toBe(false);
    expect(backgroundAiChecks({ VITEST: "true" })).toBe(false);
    expect(backgroundAiChecks({ VITEST: "true", OMB_AI_CHECKS: "1" })).toBe(true);
    expect(backgroundAiChecks({ OMB_TEST_SEALED_PATH: "1" })).toBe(false);
    expect(backgroundAiChecks({ OMB_TEST_SEALED_PATH: "1", OMB_AI_CHECKS: "1" })).toBe(true);
  });
});
