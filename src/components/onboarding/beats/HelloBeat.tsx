import { useId, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import { brand } from "@/lib/brand";
import { t } from "@/lib/i18n";
import { checkEmail, type WelcomeFields } from "@/lib/welcome-draft";
import { useStore } from "@/state/store";
import { saveWelcomeProfile, type SavedProfile } from "../save-profile";
import { inputClass, PrimaryButton, QuietButton, staggerIndex, type BeatProps } from "./shared";

/** The name and email live in the flow (`fields`), so Skip and a reload keep them; the email is optional. */
export function HelloBeat({
  onNext,
  onSkip,
  hosted = false,
  fields,
  onFields,
  saved,
}: BeatProps & { hosted?: boolean; fields: WelcomeFields; onFields: (fields: WelcomeFields) => void; saved: SavedProfile }) {
  const { dispatch } = useStore();
  const pending = useRef(false);
  const noteId = useId();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const email = checkEmail(fields.email);

  const saveProfile = async () => {
    if (email === "invalid" || pending.current) return;
    pending.current = true;
    setSaving(true);
    setFailed(false);
    try {
      await saveWelcomeProfile(fields, saved, dispatch, true);
      onNext();
    } catch {
      setFailed(true);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  const later = () => {
    if (pending.current) return;
    track("email_skipped");
    void saveWelcomeProfile(fields, saved, dispatch, false).catch(() => {});
    onSkip();
  };

  if (hosted) {
    return (
      <div className="stagger flex flex-col items-center">
        <p className="animate-rise mt-1.5 text-center text-[14px] leading-relaxed text-ink-secondary" style={staggerIndex(0)}>
          {t("onboarding.hosted.intro")}
        </p>
        <PrimaryButton onClick={onNext} className="animate-rise mt-5" style={staggerIndex(1)}>
          {t("onboarding.continue")}
        </PrimaryButton>
      </div>
    );
  }

  return (
    <div className="stagger flex flex-col items-center">
      <p className="animate-rise mt-1.5 text-center text-[14px] leading-relaxed text-ink-secondary" style={staggerIndex(0)}>
        {t("onboarding.intro")}
      </p>
      <input
        autoFocus
        type="text"
        aria-label={t("onboarding.name")}
        value={fields.name}
        onChange={(e) => onFields({ ...fields, name: e.target.value })}
        placeholder={t("onboarding.name")}
        className={`animate-rise mt-5 ${inputClass}`}
        style={staggerIndex(1)}
      />
      <input
        type="email"
        aria-label={t("phone.signIn.email")}
        aria-invalid={email === "invalid"}
        aria-describedby={noteId}
        value={fields.email}
        onChange={(e) => onFields({ ...fields, email: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && void saveProfile()}
        placeholder="you@example.com"
        className={`animate-rise mt-3 ${inputClass}`}
        style={staggerIndex(2)}
      />
      <p id={noteId} aria-live="polite" className="animate-rise mt-1.5 w-full text-[12px] leading-snug" style={staggerIndex(2)}>
        {email === "invalid" ? (
          <span className="text-danger">{t("onboarding.email.invalid")}</span>
        ) : (
          <span className="text-ink-secondary">{t("onboarding.email.why", { app: brand().name })}</span>
        )}
      </p>
      {failed && <p role="alert" className="mt-3 text-[13px] text-danger">{t("onboarding.profile.error")}</p>}
      <PrimaryButton onClick={() => void saveProfile()} disabled={email === "invalid" || saving} className="animate-rise mt-3" style={staggerIndex(3)}>
        {saving ? t("onboarding.saving") : t("onboarding.continue")}
      </PrimaryButton>
      <QuietButton onClick={later} disabled={saving} className="animate-rise mt-3 disabled:opacity-50" style={staggerIndex(4)}>
        {t("onboarding.maybeLater")}
      </QuietButton>
    </div>
  );
}
