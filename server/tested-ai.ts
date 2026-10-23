// Test before trusting: a new bot's default is an AI that answered one tiny test message whenever any AI did. Nothing
// waits for a test: the default is chosen by ranking at once (shared/ai-ranking.ts), the tests run in the background, best
// AI first, one at a time, and stop at the first AI that answers. When the pick didn't answer and another AI did, the
// default moves there (selectDefaultModelSelection's `answered`), and the first bot the app made follows it while the
// person hasn't written to it. A saved default is never tested here and never moves. Results last until that AI's
// sign-in changes, or the engine is loaded again.
import { aiSignInKey, rankAis, type AiTestState } from "../shared/ai-ranking.ts";
import type { ModelSelection, ProviderSnapshot } from "./contracts.ts";
import { readyToRun, type DefaultSelectionContext, type SelectableInstance } from "./default-model-selection.ts";
import { checkEngine, type CheckableEngine, type EngineCheck } from "./engine-check.ts";
import type { Store } from "./store.ts";

export interface TestedAiDeps {
  /** The live engine a test message goes through; a new one (a reload) starts without a result. */
  engine(instanceId: string): CheckableEngine | null;
  /** The default isn't the app's to choose (one the person saved in Settings or `openmausbot setup`, or a hosted workspace's): no
   * background tests, and nothing moves. */
  fixed(): boolean;
  context: DefaultSelectionContext;
  store(): Pick<Store, "bots" | "tasks" | "messagesFor" | "applyModelDefault">;
  threadBusy(botId: string, threadId: string): boolean;
  /** The selection a bot that follows the default gets: the new-bot effort added. */
  forBot(selection: ModelSelection): ModelSelection;
  /** A test finished: the server reads the default again, which settles here once more. */
  changed(): Promise<unknown> | void;
  /** Whether tests start on their own (backgroundAiChecks); a check asked for always runs. */
  background?: boolean;
  timeoutMs?: number;
}

/** On unless OMB_AI_CHECKS=0. Under vitest or a sealed test fixture (env-path.ts) only with OMB_AI_CHECKS=1, as
 * local-inject's probe: a fake engine's turn log then holds only the turns a test sends. */
export function backgroundAiChecks(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.OMB_AI_CHECKS?.trim();
  if (flag === "0") return false;
  return (env.VITEST !== "true" && env.OMB_TEST_SEALED_PATH !== "1") || flag === "1";
}

type Subject = { instanceId: string; snapshot: ProviderSnapshot };
type Entry = { key: string; engine: CheckableEngine; state: AiTestState; run?: Promise<EngineCheck> };

const same = (a: ModelSelection, b: ModelSelection) => a.instanceId === b.instanceId && a.model === b.model;
const stateOf = (check: EngineCheck): AiTestState => check.ok === true ? "passed" : check.ok === false ? "failed" : "untestable";
const hasModel = (instance: SelectableInstance) =>
  Boolean(instance.models.default.trim() || instance.models.options.some((option) => option.id.trim()));

export function createTestedAi(deps: TestedAiDeps) {
  const background = deps.background ?? backgroundAiChecks();
  const entries = new Map<string, Entry>();
  let lastPick: ModelSelection | null = null;

  /** This AI's result as it is signed in now. */
  const entryOf = (subject: Subject): Entry | undefined => {
    const entry = entries.get(subject.instanceId);
    return entry && entry.key === aiSignInKey(subject.snapshot) && entry.engine === deps.engine(subject.instanceId) ? entry : undefined;
  };

  /** A fresh test, or the one already under way for this sign-in. */
  const test = (subject: Subject): Promise<EngineCheck> => {
    const engine = deps.engine(subject.instanceId);
    if (!engine) return Promise.resolve({ ok: null });
    const current = entryOf(subject);
    if (current?.run) return current.run;
    const key = aiSignInKey(subject.snapshot);
    const run = checkEngine(engine, deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs });
    const entry: Entry = { key, engine, state: "testing", run };
    entries.set(subject.instanceId, entry);
    void run.then((check) => {
      if (entries.get(subject.instanceId) !== entry) return;
      entries.set(subject.instanceId, { key, engine, state: stateOf(check) });
      void Promise.resolve().then(deps.changed).catch((error: unknown) => {
        console.warn(`[engines] reading the new-bot default again after a test message: ${error instanceof Error ? error.message : String(error)}`);
      });
    });
    return run;
  };

  /** Best AI first, one at a time: an AI that didn't answer hands over to the next; one that answered, or that has no
   * one-off call to test with (trusted as before), ends the round. */
  const sweep = (instances: readonly SelectableInstance[]) => {
    for (const instance of rankAis(instances.filter((candidate) => readyToRun(candidate, deps.context) && hasModel(candidate)))) {
      const state = entryOf(instance)?.state;
      if (state === "failed") continue;
      if (state === undefined) void test(instance);
      return;
    }
  };

  /** The first bot the app made follows the default while the person hasn't written to it or chosen a conversation's AI. */
  const follow = (from: ModelSelection, to: ModelSelection) => {
    const store = deps.store();
    for (const bot of store.bots) {
      if (!bot.chiefOfStaff || !same(bot.modelSelection, from)) continue;
      const tasks = store.tasks(bot.id);
      if (tasks.some((task) => task.modelSelection !== undefined || deps.threadBusy(bot.id, task.threadId)
        || store.messagesFor(task.threadId).some((message) => message.role === "user"))) continue;
      store.applyModelDefault(bot.id, deps.forBot(to));
    }
  };

  const state = (subject: Subject): AiTestState | undefined => entryOf(subject)?.state;

  return {
    /** The default the server just chose for new bots: tests start from it, and the first bot follows a change of it.
     * Returns the selection unchanged. */
    settle(selection: ModelSelection, instances: readonly SelectableInstance[]): ModelSelection {
      if (deps.fixed()) {
        lastPick = null;
        return selection;
      }
      if (background) sweep(instances);
      const from = lastPick;
      lastPick = selection.instanceId && selection.model ? selection : null;
      if (from && lastPick && !same(from, lastPick)) follow(from, lastPick);
      return selection;
    },
    /** For selectDefaultModelSelection: true it answered, false it didn't, undefined not tested. */
    answered(instance: Subject): boolean | undefined {
      const result = state(instance);
      return result === "passed" ? true : result === "failed" ? false : undefined;
    },
    state,
    /** The instance info's field the welcome reads (`aiTest`). */
    info(instance: Subject): { aiTest?: AiTestState } {
      const result = state(instance);
      return result ? { aiTest: result } : {};
    },
    /** POST /api/instances/:id/check: live, as setup's check always was, sharing only a test already under way. */
    async check(instance: CheckableEngine & { snapshot(): Promise<ProviderSnapshot> }): Promise<EngineCheck> {
      return test({ instanceId: instance.instanceId, snapshot: await instance.snapshot() });
    },
    testing(): boolean {
      return [...entries.values()].some((entry) => entry.state === "testing");
    },
  };
}

export type TestedAi = ReturnType<typeof createTestedAi>;
