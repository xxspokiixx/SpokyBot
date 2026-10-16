/** The first-run welcome's version: a record that finished an older one shows the welcome again. */
export declare const WELCOME_VERSION: number;
/** The welcome's Cloud beat, recorded when it is shown, so a later Cloud pitch need not repeat it at once. */
export declare const ONBOARDING_CLOUD_HINT: string;
/** A workspace's `onboarding` record in its config.json, read by main too; anything malformed reads as nothing done. */
export declare function onboardingRecord(config: unknown): { finished: boolean; hints: string[] };
