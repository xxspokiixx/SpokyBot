import { identifyEmail } from "@/lib/analytics";
import { checkEmail, profilePatch, type WelcomeFields } from "@/lib/welcome-draft";
import { api, type useStore } from "@/state/store";

type Dispatch = ReturnType<typeof useStore>["dispatch"];

/** Saves what the welcome's greeting has typed (profilePatch) to the profile. Only Continue (`submitted`) also ties analytics
 * to the email (docs/analytics.md); Maybe later and Skip keep it in this computer's profile only. */
export async function saveWelcomeProfile(
  fields: WelcomeFields,
  saved: { name?: string; email?: string } | undefined,
  dispatch: Dispatch,
  submitted: boolean,
): Promise<void> {
  const patch = profilePatch(fields, saved);
  if (patch) {
    const config = await api("/api/config", { method: "PUT", body: JSON.stringify(patch), signal: AbortSignal.timeout(10_000) });
    dispatch({ type: "configStatus", config });
  }
  if (submitted && checkEmail(fields.email) === "valid") identifyEmail(fields.email.trim().toLowerCase());
}
