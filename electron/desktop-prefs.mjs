// What this desktop keeps whatever page its window shows, whichever port its own page is served on: the notices it
// has shown, and its usage-analytics switch.
import fs from "node:fs";
import { localDay } from "./cloud-trial-notice.mjs";

/** The only notices a page may record, so no page can write anything else into the file. */
export const DESKTOP_NOTICES = Object.freeze(["cloud-pro-update-2026-10"]);
const CLOUD_PRO = DESKTOP_NOTICES[0];
export const HANDOFF_MS = 2 * 60_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function jsonFile(file) {
  return {
    read: () => JSON.parse(fs.readFileSync(file, "utf8")),
    write: value => fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 }),
  };
}

function parse(raw) {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const seen = Array.isArray(record.seen) ? DESKTOP_NOTICES.filter(id => record.seen.includes(id)) : [];
  const shown = Object.fromEntries(DESKTOP_NOTICES.flatMap(id => {
    const day = record.shown && typeof record.shown === "object" ? record.shown[id] : undefined;
    return typeof day === "string" && DAY.test(day) ? [[id, day]] : [];
  }));
  return { seen, shown, ...(typeof record.analytics === "boolean" ? { analytics: record.analytics } : {}) };
}

/** A record that cannot be written is still kept for this launch. */
export function createDesktopPrefs({ read, write, now = Date.now }) {
  let record = null;
  const current = () => {
    if (record) return record;
    let raw = null;
    try { raw = read(); } catch {}
    return (record = parse(raw));
  };
  const save = next => { record = next; try { write(next); } catch {} };
  return {
    seen: () => [...current().seen],
    markSeen(id) {
      const saved = current();
      if (DESKTOP_NOTICES.includes(id) && !saved.seen.includes(id)) save({ ...saved, seen: [...saved.seen, id] });
    },
    /** True the first time a notice not yet seen counts as shown on a calendar day. */
    shown(id) {
      const saved = current(), day = localDay(now());
      if (!DESKTOP_NOTICES.includes(id) || saved.seen.includes(id) || saved.shown[id] === day) return false;
      save({ ...saved, shown: { ...saved.shown, [id]: day } });
      return true;
    },
    /** null until a choice is saved. */
    analytics: () => current().analytics ?? null,
    setAnalytics(enabled) { save({ ...current(), analytics: enabled === true }); },
  };
}

/**
 * `page(event)`: "local" for this computer's page, "server" for the saved server open in this desktop's window, null
 * for anything else. `cloudOffered()`: this desktop sells MausBot Cloud, asked once its Cloud sign-in is restored.
 * `thisComputer()`: switches the window to This computer, false when it cannot.
 */
export function registerDesktopPrefs({ ipcMain, read, write, page, cloudOffered, thisComputer, now = Date.now }) {
  let prefs = null;
  const store = () => prefs ??= createDesktopPrefs({ read, write, now });
  let handoffAt = 0;
  const from = (channel, pages, handler) => (event, ...args) => {
    if (!pages.includes(page(event))) throw new Error(`${channel} is only available in this app's window`);
    return handler(...args);
  };
  const ANY = ["local", "server"];
  ipcMain.handle("desktop-notices:state", from("desktop-notices:state", ANY, async () => ({ seen: store().seen(), cloud: await cloudOffered() })));
  ipcMain.handle("desktop-notices:seen", from("desktop-notices:seen", ANY, id => { store().markSeen(id); }));
  ipcMain.handle("desktop-notices:shown", from("desktop-notices:shown", ANY, id => store().shown(id)));
  // A saved server's page switches the window once, for the Cloud Pro popup it showed; This computer's page then finishes the click.
  ipcMain.handle("desktop-notices:this-computer", from("desktop-notices:this-computer", ["server"], async () => {
    if (!(await cloudOffered()) || store().seen().includes(CLOUD_PRO)) return false;
    store().markSeen(CLOUD_PRO);
    handoffAt = now();
    if (await thisComputer()) return true;
    handoffAt = 0;
    return false;
  }));
  ipcMain.handle("desktop-notices:handoff", from("desktop-notices:handoff", ["local"], () => {
    const taken = handoffAt > 0 && now() - handoffAt < HANDOFF_MS;
    handoffAt = 0;
    return taken;
  }));
  ipcMain.on("desktop-analytics:read", event => {
    try { event.returnValue = page(event) === "local" ? store().analytics() : null; } catch { event.returnValue = null; }
  });
  ipcMain.handle("desktop-analytics:set", from("desktop-analytics:set", ["local"], enabled => { store().setAnalytics(enabled === true); }));
}
