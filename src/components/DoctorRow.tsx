import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api } from "@/state/api";
import { AdminOnly } from "./AdminOnly";
import { SettingRow } from "./SettingsPrimitives";

/** What the server's last start found, and what a run now finds: the doctor as a person sees it. */
interface DoctorSummary {
  at: string;
  version: string;
  checked: number;
  fixed: string[];
  problems: string[];
  thisStart: boolean;
}

interface DoctorAnswer {
  summary: DoctorSummary;
  lines: string[];
  report: { counts: { checked: number; problems: number; fixed: number }; backup: string | null };
}

/**
 * The data folder's health, and its safe repairs. This is the one place a person on a phone can run them: there is no
 * terminal on Android, and a server the system killed mid-save is a normal start there. Admin only; the repairs copy
 * what they change first, and touch nothing outside the data folder.
 */
export function DoctorRow() {
  const [running, setRunning] = useState<"look" | "fix" | null>(null);
  const [answer, setAnswer] = useState<DoctorAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setAnswer(await api<DoctorAnswer>("/api/diagnostics/doctor", { background: true }));
    } catch {
      // A server too old to have the route simply shows nothing; the row is not an error by itself.
      setAnswer(null);
    }
  };
  useEffect(() => { void load(); }, []);

  const run = async (fix: boolean) => {
    if (running) return;
    setRunning(fix ? "fix" : "look");
    setError(null);
    try {
      setAnswer(await api<DoctorAnswer>("/api/diagnostics/doctor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fix }) }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(null);
    }
  };

  const problems = answer?.summary.problems ?? [];
  return (
    <AdminOnly>
      <SettingRow
        title={t("settings.doctor.title")}
        subtitle={t("settings.doctor.subtitle")}
        message={<>
          {answer && (
            <p data-doctor-summary role="status" className="text-ink-secondary">
              {t("settings.doctor.checked", { count: String(answer.summary.checked) })}
              {problems.length
                ? ` ${t("settings.doctor.problems", { list: problems.join(", ") })}`
                : ` ${t("settings.doctor.allFine")}`}
            </p>
          )}
          {answer?.lines.length ? (
            <ul data-doctor-lines className="list-disc pl-5 text-ink-secondary">
              {answer.lines.slice(0, 8).map((line) => <li key={line} className="break-words">{line}</li>)}
            </ul>
          ) : null}
          {error && <p role="alert" className="text-danger">{error}</p>}
        </>}
      >
        <div className="flex flex-wrap gap-2">
          <button type="button" className="ui-button" disabled={running !== null} onClick={() => void run(false)}>
            {running === "look" ? t("settings.doctor.looking") : t("settings.doctor.look")}
          </button>
          <button type="button" className={cn("ui-button", problems.length ? "" : "opacity-60")} disabled={running !== null} onClick={() => void run(true)}>
            {running === "fix" ? t("settings.doctor.fixing") : t("settings.doctor.fix")}
          </button>
        </div>
      </SettingRow>
    </AdminOnly>
  );
}
