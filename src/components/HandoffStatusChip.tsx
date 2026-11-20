import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { HandoffState, HandoffStatusLine } from "../../shared/handoff-status";

const TONE: Record<HandoffState, string> = {
  claimed: "text-ink-secondary",
  working: "text-success",
  waiting: "text-ink-secondary",
  done: "text-success",
  failed: "text-danger",
};

/**
 * Where work this bot handed another stands: one line under the "Sent to" row, and on the conversation doing the
 * work. A name appears only when the server sent one — on a Team Cloud — because everywhere else the person being
 * waited on is the reader.
 */
export function HandoffStatusChip({ handoff }: { handoff: HandoffStatusLine }) {
  const words = handoff.state === "waiting" && handoff.waitingOn?.kind === "person"
    ? t("handoff.waitingOnYou")
    : t(`handoff.${handoff.state}` as const);
  const who = handoff.waitingOn?.kind === "bot" && handoff.waitingOn.name ? handoff.waitingOn.name : undefined;
  return (
    <span data-handoff={handoff.state} className={cn("inline-flex items-baseline gap-1 text-[12px]", TONE[handoff.state])}>
      <span>{words}</span>
      {who && <span className="text-ink-tertiary">{who}</span>}
      {handoff.why && <span className="text-danger">{handoff.why}</span>}
      {handoff.forPerson?.name && !handoff.forPerson.private && (
        <span className="text-ink-tertiary">{t("handoff.forPerson", { name: handoff.forPerson.name })}</span>
      )}
    </span>
  );
}
