import { useEffect, useState } from "react";
import { Laptop } from "lucide-react";

import type { PageLending } from "../../electron/cloud-lending-ipc.mjs";
import { activeLocale, t } from "@/lib/i18n";
import { localizedRelativeTime } from "@/lib/memory";
import { api } from "@/state/store";
import { lendingProblemKey, lentWhat } from "./CloudLending";
import { Card, Switch } from "./SettingsPrimitives";

/** A computer lent to this server, now or before (server/shared-computers.ts KnownLentComputer). */
export interface KnownLentComputer {
  id: string;
  name: string;
  platform: "darwin" | "win32" | "linux" | null;
  online: boolean;
  busy: boolean;
  lent: boolean;
  lastSeenAt: number;
  lastUsedAt: number | null;
  scopes: { folders: number; terminal: boolean; screen: boolean };
}

const PLATFORM: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };

export function lentComputerLines(computer: KnownLentComputer, now = Date.now()): string[] {
  const state = !computer.lent ? t("lending.cloudSide.stopped", { when: localizedRelativeTime(computer.lastSeenAt, activeLocale(), now) })
    : computer.busy ? t("lending.cloudSide.busy")
    : computer.online ? t("lending.cloudSide.online")
    : t("lending.cloudSide.offline", { when: localizedRelativeTime(computer.lastSeenAt, activeLocale(), now) });
  const what = [
    ...(computer.scopes.folders ? [t("lending.cloudSide.folders", { count: String(computer.scopes.folders) })] : []),
    ...(computer.scopes.screen ? [t("lending.cloudSide.screen")] : []),
    ...(computer.scopes.terminal ? [t("lending.cloudSide.terminal")] : []),
  ];
  return [state, ...(computer.lent && what.length ? [t("lending.cloudSide.lends", { what: what.join(", ") })] : []),
    computer.lastUsedAt ? t("lending.cloudSide.lastUsed", { when: localizedRelativeTime(computer.lastUsedAt, activeLocale(), now) }) : t("lending.cloudSide.neverUsed")];
}

/** The one line under the switch: what My Cloud can use here, how it's going, or that it's off. */
export function pageLendingLine(lending: PageLending): string {
  if (!lending.on) return t("lending.page.off");
  if (lending.status === "busy") return t("lending.status.busy");
  if (lending.status && lending.status !== "lent" && lending.status !== "starting") return t(lendingProblemKey(lending.status) ?? "lending.status.starting");
  if (lending.status === "starting") return t("lending.status.starting");
  const what = lentWhat(lending.folders, lending.screen);
  return what ? t("lending.page.lends", { what }) : t("lending.status.lent");
}

/** In the desktop app on My Cloud's own page: "Let My Cloud use this computer" right here, one switch and one line, so
 * nobody has to leave My Cloud. Main confirms turning it on in a native dialog. */
function LendThisComputer({ bridge }: { bridge: { state(): Promise<PageLending>; set(on: boolean): Promise<PageLending> } }) {
  const [lending, setLending] = useState<PageLending | null>(null);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const read = () => void bridge.state().then((next) => { if (alive) setLending(next); }).catch(() => {});
    read();
    const timer = setInterval(read, 3000);
    return () => { alive = false; clearInterval(timer); };
  }, [bridge]);
  if (!lending?.available) return null;
  const toggle = () => {
    setWorking(true); setFailed(false);
    void bridge.set(!lending.on).then(setLending).catch(() => setFailed(true)).finally(() => setWorking(false));
  };
  return <div data-lend-this-computer={lending.on ? "on" : "off"} className="flex flex-col gap-1.5 rounded-lg bg-raised/60 p-3">
    <div className="flex items-start justify-between gap-3">
      <p id="lend-this-computer" className="text-[13px] font-medium text-ink">{t("lending.title")}</p>
      <Switch checked={lending.on} disabled={working} aria-labelledby="lend-this-computer" onClick={toggle} />
    </div>
    <p role="status" className="text-[12.5px] text-ink-secondary">{pageLendingLine(lending)}</p>
    {failed && <p role="alert" className="text-[12.5px] text-danger">{t("lending.failed")}</p>}
  </div>;
}

/** My Cloud's own page: this computer's lending switch (in the desktop app), then each computer lent to it, whether it is
 * online or since when not, what it lends and when My Cloud last used it. */
export function LentComputersCard() {
  const [known, setKnown] = useState<KnownLentComputer[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    // The 15-second poll never wakes a Cloud home that went to sleep.
    const load = (background = false) => api<{ known?: KnownLentComputer[] }>("/api/shared-computers", background ? { background } : undefined)
      .then((answer) => { if (alive) { setKnown(answer.known ?? []); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    void load();
    const timer = setInterval(() => void load(true), 15_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  const lending = window.ogb?.cloudLending;
  const here = lending?.state && lending.set ? { state: lending.state, set: lending.set } : null;
  return <Card title={t("lending.cloudSide.title")}>
    <div data-lent-computers={known === null ? "loading" : known.length} className="flex flex-col gap-3">
      {here && <LendThisComputer bridge={here} />}
      {failed && <p role="alert" className="text-[13px] text-danger">{t("lending.cloudSide.error")}</p>}
      {known?.length === 0 && <p className="text-[13px] text-ink-secondary">{t("lending.cloudSide.empty")}</p>}
      {!!known?.length && <ul className="divide-y divide-hairline/40">
        {known.map((computer) => <li key={computer.id} data-lent-computer={computer.online ? "online" : computer.lent ? "offline" : "stopped"} className="flex items-start gap-2 py-2.5">
          <Laptop size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-secondary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink">{computer.name}{computer.platform ? <span className="font-normal text-ink-secondary"> · {PLATFORM[computer.platform]}</span> : null}</p>
            {lentComputerLines(computer).map((line) => <p key={line} className="text-[12px] text-ink-secondary">{line}</p>)}
          </div>
        </li>)}
      </ul>}
    </div>
  </Card>;
}
