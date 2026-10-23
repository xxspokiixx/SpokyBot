/** One full-screen ask per launch after the welcome: MausBot's first-launch card, or the notices queue's Cloud Pro popup
 * with the product-updates question after it. Whichever opens first owns the launch; the other waits for a later one.
 * Kept for the window's session, so a reload counts as the same launch (like welcomeFinishedThisLaunch). */
export type LaunchDialog = "mausbot" | "notices";

const KEY = "omb.launch.dialog";

export function launchDialogShown(): LaunchDialog | null {
  try {
    const owner = sessionStorage.getItem(KEY);
    return owner === "mausbot" || owner === "notices" ? owner : null;
  } catch {
    return null;
  }
}

/** The first claim of a launch holds; a later one changes nothing. */
export function markLaunchDialog(owner: LaunchDialog): void {
  try {
    if (!launchDialogShown()) sessionStorage.setItem(KEY, owner);
  } catch {
  }
}
