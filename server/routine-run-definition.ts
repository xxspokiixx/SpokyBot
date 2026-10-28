import { cloneAttachments } from "./routine-attachments.ts";
import type { Routine, RoutineRun } from "./routines.ts";

export function routineRunDefinition(routine: Routine): Pick<RoutineRun,
  "routineName" | "prompt" | "durationMinutes" | "timeoutMinutes" | "attachments" | "target" | "groupId" | "botId" | "runOn" | "access" | "deliver"> {
  return {
    routineName: routine.name,
    prompt: routine.prompt,
    durationMinutes: routine.durationMinutes,
    ...(routine.timeoutMinutes === undefined ? {} : { timeoutMinutes: routine.timeoutMinutes }),
    attachments: cloneAttachments(routine.attachments),
    target: routine.target,
    groupId: routine.groupId,
    botId: routine.botId,
    runOn: routine.runOn ?? "maus",
    access: routine.access,
    deliver: routine.deliver,
  };
}
