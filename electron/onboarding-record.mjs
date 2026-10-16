export const WELCOME_VERSION = 1;
export const ONBOARDING_CLOUD_HINT = "onboarding-cloud-v1";

export function onboardingRecord(config) {
  const record = config && typeof config === "object" && config.onboarding && typeof config.onboarding === "object" ? config.onboarding : {};
  const finished = typeof record.completedAt === "string" && record.completedAt.trim() !== ""
    && typeof record.version === "number" && record.version >= WELCOME_VERSION;
  return { finished, hints: Array.isArray(record.hintsSeen) ? record.hintsSeen.filter(hint => typeof hint === "string") : [] };
}
