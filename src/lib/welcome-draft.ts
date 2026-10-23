import { BEAT_ORDER, WELCOME_VERSION, type BeatId } from "./onboarding";

export interface WelcomeFields {
  name: string;
  email: string;
}

export interface WelcomeDraft extends WelcomeFields {
  beat: BeatId;
}

export type EmailCheck = "empty" | "valid" | "invalid";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FIELD_LIMIT = 320;

/** The email is optional: none is fine, and only one being typed wrong holds the welcome. */
export function checkEmail(value: string): EmailCheck {
  const trimmed = value.trim();
  if (!trimmed) return "empty";
  return EMAIL.test(trimmed) ? "valid" : "invalid";
}

/** What the welcome saves to the profile: a typed name and a valid email. Never blanks over saved values, nothing unchanged. */
export function profilePatch(fields: WelcomeFields, saved?: { name?: string; email?: string }): { profile: { name?: string; email?: string } } | null {
  const profile: { name?: string; email?: string } = {};
  const name = fields.name.trim();
  const email = fields.email.trim().toLowerCase();
  if (name && name !== saved?.name) profile.name = name;
  if (checkEmail(email) === "valid" && email !== saved?.email) profile.email = email;
  return Object.keys(profile).length ? { profile } : null;
}

/** The welcome in progress, kept in this browser beside the email gate (analytics) so a reload resumes it. */
export const WELCOME_DRAFT_KEY = "omb.onboarding.welcomeDraft";

const text = (value: unknown): value is string => typeof value === "string" && value.length <= FIELD_LIMIT;

export function readWelcomeDraft(): WelcomeDraft | null {
  try {
    const raw = localStorage.getItem(WELCOME_DRAFT_KEY);
    const draft = raw ? (JSON.parse(raw) as (Partial<WelcomeDraft> & { version?: unknown }) | null) : null;
    if (!draft || typeof draft !== "object" || draft.version !== WELCOME_VERSION) return null;
    if (!BEAT_ORDER.includes(draft.beat as BeatId) || !text(draft.name) || !text(draft.email)) return null;
    return { beat: draft.beat as BeatId, name: draft.name, email: draft.email };
  } catch {
    return null;
  }
}

export function saveWelcomeDraft(draft: WelcomeDraft): void {
  try {
    localStorage.setItem(WELCOME_DRAFT_KEY, JSON.stringify({ version: WELCOME_VERSION, beat: draft.beat, name: draft.name.slice(0, FIELD_LIMIT), email: draft.email.slice(0, FIELD_LIMIT) }));
  } catch {
  }
}

export function clearWelcomeDraft(): void {
  try {
    localStorage.removeItem(WELCOME_DRAFT_KEY);
  } catch {
  }
}
