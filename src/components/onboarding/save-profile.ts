import { identifyEmail } from "@/lib/analytics";
import { checkEmail, profilePatch, type WelcomeFields } from "@/lib/welcome-draft";
import { api, type useStore } from "@/state/store";

type Dispatch = ReturnType<typeof useStore>["dispatch"];

/** The profile as the welcome last saved it (or is saving it), shared by its greeting and its finish so a field is sent
 * once, however the welcome ends. `pending` is a save still on its way. */
export interface SavedProfile {
  current: { name?: string; email?: string } | undefined;
  pending?: Promise<unknown>;
}

/** Saves what the welcome's greeting has typed (profilePatch) to the profile. Only Continue (`submitted`) also ties analytics
 * to the email (docs/analytics.md); Maybe later and Skip keep it in this computer's profile only. */
export async function saveWelcomeProfile(fields: WelcomeFields, saved: SavedProfile, dispatch: Dispatch, submitted: boolean): Promise<void> {
  const patch = profilePatch(fields, saved.current);
  if (patch) {
    const before = saved.current;
    const sending = { ...before, ...patch.profile };
    saved.current = sending;
    const request = api("/api/config", { method: "PUT", body: JSON.stringify(patch), signal: AbortSignal.timeout(10_000) });
    saved.pending = request;
    try {
      dispatch({ type: "configStatus", config: await request });
    } catch (error) {
      if (saved.current === sending) saved.current = before;
      throw error;
    } finally {
      if (saved.pending === request) saved.pending = undefined;
    }
  }
  if (submitted && checkEmail(fields.email) === "valid") identifyEmail(fields.email.trim().toLowerCase());
}

/** The welcome's end: waits for a save already on its way, then sends what it did not save (so a failed one is tried once more). */
export async function settleWelcomeProfile(fields: WelcomeFields, saved: SavedProfile, dispatch: Dispatch): Promise<void> {
  await saved.pending?.catch(() => {});
  await saveWelcomeProfile(fields, saved, dispatch, false);
}
