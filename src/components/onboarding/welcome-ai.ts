import { useEffect, useState } from "react";
import { aiSignInKey, type AiTestState } from "../../../shared/ai-ranking";
import { engineReady } from "@/components/EngineLibrary";
import { welcomeAi } from "@/lib/onboarding";
import { api, type InstanceInfo } from "@/state/store";

type Answer = { ok?: boolean | null } | undefined;

const keyOf = (instance: InstanceInfo) => `${instance.instanceId}\n${aiSignInKey(instance.snapshot)}`;

/** The AI the welcome stands on (welcomeAi), after one tiny test message through the server's check when this sign-in
 * hasn't had one: the server shares a test already under way, and its result also settles the new-bot default. A check
 * that can't be made trusts the AI as before. `enabled` is false for a viewer who can't run checks. */
export function useWelcomeAi(instances: readonly InstanceInfo[], enabled = true) {
  const [answers, setAnswers] = useState<Record<string, AiTestState>>({});
  const found = welcomeAi(instances, engineReady, (instance) => answers[keyOf(instance)] ?? (instance.aiTest === "testing" ? undefined : instance.aiTest));
  const asking = enabled && found?.state === "testing" ? keyOf(found.instance) : null;
  useEffect(() => {
    if (!asking) return;
    let live = true;
    const instanceId = asking.slice(0, asking.indexOf("\n"));
    void api<Answer>(`/api/instances/${encodeURIComponent(instanceId)}/check`, { method: "POST", body: "{}", timeoutMs: 120_000 })
      .then((answer): AiTestState => answer?.ok === true ? "passed" : answer?.ok === false ? "failed" : "untestable", (): AiTestState => "untestable")
      .then((state) => {
        if (live) setAnswers((current) => ({ ...current, [asking]: state }));
      });
    return () => {
      live = false;
    };
  }, [asking]);
  return found;
}
