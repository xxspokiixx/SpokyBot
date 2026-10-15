import { useEffect, useRef, useState } from "react";
import type { CloudMoveState } from "../../../electron/cloud-move.mjs";
import { useCloudMove } from "@/components/CloudMove";
import { CLOUD_WELCOME_DONE, cloudWelcomeStage, welcomeStepFinished } from "@/lib/cloud-setup";
import { forgetWelcomeDoneHere, memoryStep, rememberPendingMemory, saveWelcomeHints, useCloudWelcome, withEarlyHints } from "@/lib/cloud-welcome";
import { hintSeen, type WelcomeViewer } from "@/lib/onboarding";
import { api, useStore, type Action, type ConfigStatus } from "@/state/store";
import { MemoryImport, type MemoryTrouble } from "./MemoryImport";
import { useCloudName } from "./parts";

const COPYING = new Set<CloudMoveState["phase"]>(["preparing", "growing", "exporting", "uploading", "checking", "replacing", "restarting"]);

async function saveAboutMe(aboutMe: string, dispatch: (action: Action) => void): Promise<void> {
  const config = await api<ConfigStatus>("/api/config", { method: "PUT", body: JSON.stringify({ profile: { aboutMe } }), timeoutMs: 10_000 });
  dispatch({ type: "profileSaved", profile: { aboutMe: config.profile?.aboutMe ?? aboutMe } });
}

function KeptMemory({ memory, trouble, onAgain, onLater }: { memory: string; trouble: MemoryTrouble; onAgain: () => void; onLater: () => void }) {
  const name = useCloudName();
  return <MemoryImport name={name} initial={memory} trouble={trouble} onClose={onLater}
    onDiscard={() => { onLater(); rememberPendingMemory(null); }}
    onAdd={(text) => { rememberPendingMemory(text); onAgain(); }} />;
}

/**
 * Outlives the welcome: memory pasted there reaches About me even when a copy replaces About me after the welcome
 * ends, and an end of the welcome this device kept reaches the Cloud's record.
 */
export function WelcomeKeeper({ viewer }: { viewer: WelcomeViewer | null }) {
  const { state, dispatch } = useStore();
  const welcome = useCloudWelcome();
  const saved = state.config?.onboarding;
  const resend = Boolean(welcome.doneHere && viewer?.cloudHome && viewer.canSave && state.connected && saved);
  useEffect(() => {
    if (!resend || !saved) return;
    if (hintSeen(saved, CLOUD_WELCOME_DONE)) forgetWelcomeDoneHere();
    else void saveWelcomeHints(saved, [CLOUD_WELCOME_DONE], dispatch).then((done) => { if (done) forgetWelcomeDoneHere(); });
  }, [resend, saved, dispatch]);
  const memory = viewer?.cloudHome && viewer.canSave ? welcome.memory : null;
  const move = useCloudMove(memory && !window.ogb?.remoteClient?.active ? window.ogb?.cloudMove : undefined);
  const record = withEarlyHints(state.config?.onboarding, welcome.early);
  const stage = cloudWelcomeStage({ viewer, connected: state.connected, enginesKnown: state.instances.length > 0, onboarding: record });
  const step = memoryStep({
    memory, aboutMe: state.config?.profile?.aboutMe, known: state.connected && Boolean(state.config),
    copying: move.state.action === "move" && COPYING.has(move.state.phase),
    landed: move.state.action === "move" && move.state.phase === "done",
    settled: stage !== "pending" || welcomeStepFinished(record, "bring"),
  });
  const [trouble, setTrouble] = useState<MemoryTrouble | null>(null);
  const [attempt, setAttempt] = useState(0);
  const tried = useRef<string | null>(null);
  const target = step.kind === "save" ? step.aboutMe : null;
  useEffect(() => {
    if (step.kind === "clear") rememberPendingMemory(null);
    else if (step.kind === "too-long") setTrouble("too-long");
    else if (target && tried.current !== target) {
      tried.current = target;
      void saveAboutMe(target, dispatch).catch(() => setTrouble("failed"));
    }
  }, [step.kind, target, attempt, dispatch]);
  if (!memory || !trouble) return null;
  return <KeptMemory memory={memory} trouble={trouble} onLater={() => setTrouble(null)}
    onAgain={() => { setTrouble(null); tried.current = null; setAttempt((count) => count + 1); }} />;
}
