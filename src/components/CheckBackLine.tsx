import { useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api } from "@/state/api";

/** The quiet line a check-back keeps in its conversation: one row, rewritten in place as it moves on. */
export interface CheckBackLineView {
  id: string;
  dueAt: number;
  status: "pending" | "started" | "cancelled" | "dropped" | "failed";
  note: string;
  startedAt?: number;
  why?: string;
}

function when(at: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(at));
  } catch {
    return new Date(at).toISOString();
  }
}

/**
 * A check-back's line. Only a pending one carries Cancel: a started, cancelled or failed one is a record of what happened,
 * and the bot's own words for it are the row's text for clients that do not draw this.
 */
export function CheckBackLine({ line }: { line: CheckBackLineView }) {
  const [cancelling, setCancelling] = useState(false);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const at = line.startedAt ?? line.dueAt;
  const cancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      await api(`/api/check-backs/${encodeURIComponent(line.id)}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      setGone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCancelling(false);
    }
  };

  const words = line.status === "pending"
    ? t("checkBack.pending", { when: when(line.dueAt) })
    : line.status === "started"
      ? t("checkBack.started", { when: when(at) })
      : line.status === "failed"
        ? t("checkBack.failed", { when: when(line.dueAt) })
        : t("checkBack.cancelled", { when: when(line.dueAt) });

  return (
    <div data-check-back={line.status} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px] text-ink-secondary">
      <span className={cn("font-medium", line.status === "failed" ? "text-danger" : "text-ink")}>{words}</span>
      {line.note && <span className="text-ink-tertiary">{line.note}</span>}
      {line.why && <span className="text-danger">{line.why}</span>}
      {line.status === "pending" && !gone && (
        <button
          type="button"
          onClick={() => void cancel()}
          disabled={cancelling}
          className="text-[13px] underline underline-offset-2 hover:text-ink disabled:opacity-50"
        >
          {cancelling ? t("checkBack.cancelling") : t("checkBack.cancel")}
        </button>
      )}
      {error && <span role="alert" className="text-danger">{error}</span>}
    </div>
  );
}
