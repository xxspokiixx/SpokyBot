import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { t } from "@/lib/i18n";
import { setNotificationPlace } from "@/lib/notify";

type Line = { kind: "left" | "private"; name: string };

/** The words for main's one line: a team this person is no longer in, or a team's first open on this device. */
export function homeLineText(line: Line): string {
  return line.kind === "left" ? t("homeLine.left", { name: line.name }) : t("homeLine.privateChats", { name: line.name });
}

/** In the desktop app, never in a browser: one plain line main has for this page, served once (home-places.mjs): on
 * My Cloud's page after a team dropped this person, that they are no longer in it; on a team's Cloud the first time on
 * this device, that its admins can see private chats with its bots. Nothing to press; it goes with the page. */
export function HomeLine() {
  const bridge = !window.ogb?.remoteClient?.active ? window.ogb?.workspaces : undefined;
  const [line, setLine] = useState<Line | null>(null);
  useEffect(() => {
    if (!bridge?.line) return;
    // Served once: the first ask gets the line even when a strict-mode remount asks again (and gets null, which must
    // not take it back); after a real unmount the set is a no-op.
    void bridge.line().then((next) => { if (next) setLine(next); }).catch(() => {});
    // A team's page (main's summary carries this person's role there): its notifications name the team.
    void bridge.state().then((place) => setNotificationPlace(place.role ? place.name : null)).catch(() => {});
  }, [bridge]);
  if (!line) return null;
  return <div role="status" data-home-line={line.kind} className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-hairline/40 bg-panel px-3 py-1.5 text-[12.5px] text-ink-secondary">
    <Users size={14} aria-hidden="true" />
    <span dir="auto">{homeLineText(line)}</span>
  </div>;
}
