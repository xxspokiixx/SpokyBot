// "Let My Cloud use this computer": main's IPC for it. This computer's Settings may choose folders and the screen; My
// Cloud's own page in this app (verified as the person's Cloud) gets the same one switch and what is lent, so nobody has
// to leave My Cloud to change it. Turned on with nothing chosen, it lends the usual folders, read only.

import { randomUUID } from "node:crypto";

/** The usual folders, read only (Electron app.getPath names): what most people mean by "use my computer", and nothing
 * that can change a file. */
export const DEFAULT_FOLDERS = Object.freeze(["desktop", "documents", "downloads"]);

/** The folders that still exist and pass the checks a folder chosen by hand passes; one moved or deleted since is left
 * out, instead of failing the whole switch. */
export async function existingFolders(folders, validate) {
  const found = await Promise.all(folders.map((folder) => validate([folder]).then((list) => list[0] ?? null, () => null)));
  return found.filter(Boolean);
}

/** Each usual folder that exists, read only. */
export const usualFolders = (paths, validate) => existingFolders(paths.map((path) => ({ id: randomUUID(), path, write: false })), validate);

/** My Cloud's page learns whether it is on, how it is going, and what is lent by folder name, never a path. */
export function pageLending(snapshot) {
  const state = snapshot?.state;
  const on = state?.enabled === true;
  return {
    available: snapshot?.available === true,
    on,
    status: on ? state.busy ? "busy" : state.connected ? "lent" : state.problem ?? "starting" : state?.problem ?? null,
    folders: on ? (state.folders ?? []).map((folder) => ({ name: String(folder.name ?? ""), write: folder.write === true })) : [],
    screen: on && state.screen === true,
  };
}

/**
 * @param {{
 *   ipcMain: { handle(channel: string, handler: (...args: any[]) => unknown): void },
 *   localOnly: (channel: string, handler: (...args: any[]) => unknown) => (...args: any[]) => unknown,
 *   cloudPage: (channel: string, handler: (...args: any[]) => unknown) => (...args: any[]) => unknown,
 *   snapshot: () => Promise<{ available: boolean, screenAvailable?: boolean, state?: Record<string, any>, activity?: unknown[] }>,
 *   environment: () => unknown,
 *   save: (env: unknown, choice: { folders: unknown, screen: boolean }) => Promise<unknown>,
 *   stop: () => void,
 *   chooseFolder: () => Promise<{ id: string, path: string, name: string, write: boolean } | null>,
 *   defaults: () => Promise<Array<{ id: string, path: string, name: string, write: boolean }>>,
 *   validate: (folders: unknown[]) => Promise<Array<{ id: string, path: string, name: string, write: boolean }>>,
 *   confirm: (folders: string[]) => Promise<boolean>,
 * }} deps `cloudPage` lets only My Cloud's verified page through; `confirm` asks in a native dialog, which no page can
 * draw or answer.
 */
export function installCloudLending({ ipcMain, localOnly, cloudPage, snapshot, environment, save, stop, chooseFolder, defaults, validate, confirm }) {
  const env = () => {
    const current = environment();
    if (!current) throw new Error("Open My Cloud first.");
    return current;
  };
  /** What was chosen (an off switch keeps its choice), without folders that are gone since; else the usual folders. */
  const choice = async (input) => {
    const folders = Array.isArray(input?.folders) && input.folders.length ? await existingFolders(input.folders, validate) : [];
    if (folders.length || input?.screen === true) return { folders, screen: input?.screen === true };
    return { folders: await defaults(), screen: false };
  };
  ipcMain.handle("lending:state", localOnly("lending:state", () => snapshot()));
  ipcMain.handle("lending:folder", localOnly("lending:folder", async () => { env(); return chooseFolder(); }));
  ipcMain.handle("lending:save", localOnly("lending:save", async (_event, input) => {
    await save(env(), await choice(input));
    return snapshot();
  }));
  ipcMain.handle("lending:stop", localOnly("lending:stop", async () => { stop(); return snapshot(); }));

  ipcMain.handle("cloud-lending:state", cloudPage("cloud-lending:state", async () => pageLending(await snapshot())));
  ipcMain.handle("cloud-lending:set", cloudPage("cloud-lending:set", async (_event, on) => {
    if (on !== true) { stop(); return pageLending(await snapshot()); }
    const current = await snapshot();
    if (current.state?.enabled) return pageLending(current);
    const kept = current.state ?? {};
    const next = await choice({ folders: kept.folders, screen: kept.screen === true && current.screenAvailable === true });
    if (!(await confirm(next.folders.map((folder) => String(folder.name ?? ""))))) return pageLending(current);
    await save(env(), next);
    return pageLending(await snapshot());
  }));
}
