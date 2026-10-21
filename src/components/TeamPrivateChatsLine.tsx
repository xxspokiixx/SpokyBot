import { useState } from "react";
import { Users } from "lucide-react";
import { t } from "@/lib/i18n";

const SEEN_KEY = (teamId: string) => `omb.team-private-chats.${teamId}`;

/** Whether this team's line is still to be said here; saying it marks it said, so it is shown on one open only. */
export function teamPrivateChatsLineDue(teamId: string, storage: Pick<Storage, "getItem" | "setItem"> | null): boolean {
  if (!storage) return true;
  try {
    if (storage.getItem(SEEN_KEY(teamId))) return false;
    storage.setItem(SEEN_KEY(teamId), String(Date.now()));
    return true;
  } catch {
    return true;
  }
}

/** On a Team Cloud, once per team on this device: private chats with the team's bots are seen by the team's admins. */
export function TeamPrivateChatsLine({ team }: { team: { id: string; name: string } | undefined }) {
  const [due] = useState(() => (team ? teamPrivateChatsLineDue(team.id, typeof localStorage === "undefined" ? null : localStorage) : false));
  if (!team || !due) return null;
  return <div role="status" data-team-private-chats className="flex items-center justify-center gap-2 border-b border-hairline/40 bg-panel px-3 py-1.5 text-[12.5px] text-ink-secondary">
    <Users size={14} aria-hidden="true" />
    <span>{t("team.privateChats", { team: team.name })}</span>
  </div>;
}
