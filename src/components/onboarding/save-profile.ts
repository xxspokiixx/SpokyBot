import { identifyEmail } from "@/lib/analytics";
import { profilePatch, type WelcomeFields } from "@/lib/welcome-draft";
import { api, type useStore } from "@/state/store";

type Dispatch = ReturnType<typeof useStore>["dispatch"];

/** Saves what the welcome's greeting has typed (profilePatch) to the profile. `submitted` is Continue, not Maybe later or Skip. */
export async function saveWelcomeProfile(
  fields: WelcomeFields,
  saved: { name?: string; email?: string } | undefined,
  dispatch: Dispatch,
  submitted: boolean,
): Promise<void> {
  const patch = profilePatch(fields, saved);
  if (!patch) return;
  const config = await api("/api/config", { method: "PUT", body: JSON.stringify(patch), signal: AbortSignal.timeout(10_000) });
  dispatch({ type: "configStatus", config });
  if (patch.profile.email) identifyEmail(patch.profile.email, { submitted });
}
