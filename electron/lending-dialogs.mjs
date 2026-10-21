// Security: lending this computer lets bots read its folders, run commands or act in its apps as the person. These are
// main's own dialogs, which no page (this computer's or a server's) can draw or answer, and each one defaults to Cancel.
import { randomUUID } from "node:crypto";

export function serverAccessDetail(env, { folders, terminal, computer }) {
  return [
    `Server: ${env.origin}`,
    ...folders.map(folder => `${folder.write ? "Read and write" : "Read only"}: ${folder.path}`),
    terminal === true ? "Terminal: UNRESTRICTED commands as your user. Can access files outside the folders above, including credentials." : "Terminal: off",
    computer === true ? "Computer control: can view your screen and operate logged-in apps. Can access information outside the folders above." : "Computer control: off",
    "Shared content is sent to this server and may reach its model provider. Bots on this server can use these permissions until you revoke them. Closing the desktop stops access.",
  ].join("\n\n");
}

/**
 * @param {{
 *   dialog: { showOpenDialog: Function, showMessageBox: Function },
 *   window: () => ({ isDestroyed(): boolean } | null),
 *   validate: (folders: Array<{ id: string, path: string, write: boolean }>) => Promise<Array<{ id: string, path: string, name: string, write: boolean }>>,
 * }} deps
 */
export function createLendingDialogs({ dialog, window, validate }) {
  return {
    /** The folder the person picks, read only and checked as every lent folder is; null when they cancel. */
    async chooseFolder(title) {
      const picked = await dialog.showOpenDialog(window(), { title, properties: ["openDirectory"] });
      if (picked.canceled || !picked.filePaths[0]) return null;
      return (await validate([{ id: randomUUID(), path: picked.filePaths[0], write: false }]))[0];
    },
    async confirmServerAccess(env, grant) {
      const { response } = await dialog.showMessageBox(window(), { type: "warning", message: `Allow computer access for ${env.name}?`, detail: serverAccessDetail(env, grant), buttons: ["Allow access", "Cancel"], defaultId: 1, cancelId: 1 });
      return response === 0;
    },
    /** Apps and screen asked for from My Cloud's page: false when there is no window to ask in. */
    async confirmScreen() {
      const parent = window();
      if (!parent || parent.isDestroyed()) return false;
      const { response } = await dialog.showMessageBox(parent, {
        type: "warning", message: "Let your bots on My Cloud use your apps and screen?",
        detail: "In your own conversations and routines, they can see your screen, click and type in your apps as you, while this computer is awake with OpenMausBot open. That reaches anything those apps can reach. You can turn it off at any time on My Cloud's page or in Settings → MausBot Cloud.",
        buttons: ["Lend apps and screen", "Cancel"], defaultId: 1, cancelId: 1,
      });
      return response === 0;
    },
  };
}
