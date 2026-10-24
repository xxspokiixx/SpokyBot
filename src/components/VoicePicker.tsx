import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { useMenuMotion } from "./MenuMotion";

export interface PickerVoice {
  id: string;
  label: string;
  description?: string;
  publicOwnerId?: string;
}

export function VoicePicker({
  value,
  voices,
  loading,
  query,
  onQuery,
  onPick,
  defaultLabel,
  ariaLabel,
  pending,
}: {
  value: string;
  voices: PickerVoice[];
  loading: boolean;
  query: string;
  onQuery: (query: string) => void;
  onPick: (voice: PickerVoice) => void;
  defaultLabel: string;
  ariaLabel: string;
  pending?: PickerVoice;
}) {
  const [open, setOpen] = useState(false);
  const motion = useMenuMotion(open);
  const ref = useRef<HTMLDivElement>(null);
  const lastSelected = useRef<PickerVoice | undefined>(undefined);
  const listed = voices.find((voice) => voice.id === value);
  if (listed) lastSelected.current = listed;
  const selected = listed ?? (lastSelected.current?.id === value ? lastSelected.current : undefined);
  const rows: PickerVoice[] = query.trim() ? voices : [{ id: "", label: defaultLabel }, ...voices];

  const close = () => {
    setOpen(false);
    onQuery("");
  };
  const pick = (voice: PickerVoice) => {
    onPick(voice);
    close();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      // SAFETY: a mousedown target inside a document is always a DOM Node
      if (!ref.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  });

  return (
    <div className="relative min-w-0 flex-1" ref={ref}>
      <button
        type="button"
        data-voice-picker
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-busy={Boolean(pending)}
        disabled={Boolean(pending)}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex w-full items-center gap-2 rounded-lg border border-hairline/40 bg-inset py-2 pl-3 pr-2 text-left text-[13px] text-ink disabled:cursor-default"
      >
        <span className="min-w-0 flex-1 truncate">
          {pending?.label ?? selected?.label ?? (loading ? t("voice.loading") : value ? t("voice.current") : defaultLabel)}
        </span>
        {pending ? (
          <Loader2 size={14} aria-hidden className="shrink-0 animate-spin text-ink-secondary" />
        ) : (
          <ChevronDown size={14} aria-hidden className="shrink-0 text-ink-secondary" />
        )}
      </button>

      {motion.shown && (
        <div
          className={cn("absolute inset-x-0 top-full z-40 mt-1 overflow-hidden rounded-xl border border-hairline/50 bg-card py-1 shadow-2xl shadow-black/50", motion.className)}
          {...motion.exitProps}
        >
          <div className="px-2 pb-1 pt-1.5">
            <div className="flex items-center gap-2 rounded-lg border border-hairline/40 bg-inset px-2.5 py-1.5 focus-within:border-focus">
              {loading ? (
                <Loader2 size={13} className="shrink-0 animate-spin text-ink-secondary" />
              ) : (
                <Search size={13} className="shrink-0 text-ink-secondary" />
              )}
              <input
                autoFocus
                type="search"
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    if (query) onQuery("");
                    else close();
                  }
                  if (e.key === "Enter" && !e.nativeEvent.isComposing && voices[0]) {
                    e.preventDefault();
                    pick(voices[0]);
                  }
                }}
                placeholder={t("voice.search")}
                aria-label={t("voice.search")}
                autoComplete="off"
                spellCheck={false}
                className="w-full bg-transparent text-[12.5px] text-ink placeholder:text-ink-secondary focus:outline-none [&::-webkit-search-cancel-button]:hidden"
              />
            </div>
          </div>
          <div role="listbox" aria-label={ariaLabel} className="max-h-[320px] overflow-y-auto">
            {loading && voices.length === 0 ? (
              <div role="status" aria-label={t("voice.loading")}>
                {[0, 1, 2, 3].map((row) => (
                  <div key={row} className="flex items-start gap-2 px-2.5 py-2">
                    <span className="size-[13px] shrink-0" />
                    <span className="min-w-0 flex-1 animate-pulse">
                      <span className="block h-3.5 w-2/5 rounded bg-raised" />
                      <span className="mt-1.5 block h-3 w-4/5 rounded bg-raised/70" />
                    </span>
                  </div>
                ))}
              </div>
            ) : query.trim() && !loading && voices.length === 0 ? (
              <div className="px-3 py-6 text-center text-[13px] text-ink-secondary">{t("voice.noMatches")}</div>
            ) : (
              rows.map((voice) => {
                const active = voice.id === value;
                return (
                  <button
                    key={voice.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => pick(voice)}
                    className={cn("flex w-full items-start gap-2 px-2.5 py-2 text-left", active ? "bg-raised/60" : "hover:bg-raised/40")}
                  >
                    <Check size={13} className={cn("mt-0.5 shrink-0", active ? "text-accent" : "opacity-0")} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 truncate text-[13px] text-ink">{voice.label}</span>
                        {voice.publicOwnerId && (
                          <span className="shrink-0 text-[11px] text-ink-secondary">{t("voice.addsToAccount")}</span>
                        )}
                      </span>
                      {voice.description && (
                        <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-ink-secondary">
                          {voice.description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
