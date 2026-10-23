import { identifyEmail } from "@/lib/analytics";
import { checkEmail, profilePatch, type WelcomeFields } from "@/lib/welcome-draft";
import { api, type useStore } from "@/state/store";

type Dispatch = ReturnType<typeof useStore>["dispatch"];

/** The profile as the welcome last saved it (or is saving it), shared by its greeting and its finish so a field is sent
 * once, however the welcome ends. */
export interface SavedProfile {
  current: { name?: string; email?: string } | undefined;
}

/** Saves what the welcome's greeting has typed (profilePatch) to the profile. Only Continue (`submitted`) also ties analytics
 * to the email (docs/analytics.md); Maybe later and Skip keep it in this computer's profile only. */
export async function saveWelcomeProfile(fields: WelcomeFields, saved: SavedProfile, dispatch: Dispatch, submitted: boolean): Promise<void> {
  const patch = profilePatch(fields, saved.current);
  if (patch) {
    const before = saved.current;
    const sending = { ...before, ...patch.profile };
    saved.current = sending;
    try {
      const config = await api("/api/config", { method: "PUT", body: JSON.stringify(patch), signal: AbortSignal.timeout(10_000) });
      dispatch({ type: "configStatus", config });
    } catch (error) {
      if (saved.current === sending) saved.current = before;
      throw error;
    }
  }
  if (submitted && checkEmail(fields.email) === "valid") identifyEmail(fields.email.trim().toLowerCase());
}
