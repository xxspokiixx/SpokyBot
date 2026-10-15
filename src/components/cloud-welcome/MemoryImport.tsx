import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy } from "lucide-react";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { useCopyFeedback } from "@/lib/copy-text";
import { ABOUT_ME_LIMIT, withMemory } from "@/lib/cloud-welcome";
import { activeLocale, t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { PRIMARY, QUIET, SECONDARY } from "./parts";

export type MemoryTrouble = "failed" | "too-long";

/** Takes the answer from Claude or ChatGPT and hands it on to be added to About me. */
export function MemoryImport({ name, initial = "", trouble = null, onClose, onAdd, onDiscard }: {
  name: string;
  initial?: string;
  /** Why a paste kept on this device is shown again. */
  trouble?: MemoryTrouble | null;
  onClose: () => void;
  onAdd: (memory: string) => void;
  onDiscard?: () => void;
}) {
  const { state } = useStore();
  const dialog = useRef<HTMLDivElement>(null);
  useModalDialog(dialog, onClose);
  const prompt = t("cloudWelcome.memory.prompt");
  const copy = useCopyFeedback(prompt);
  const [memory, setMemory] = useState(initial);
  const before = state.config?.profile?.aboutMe ?? "";
  const over = withMemory(before, memory).length - ABOUT_ME_LIMIT;
  const ready = memory.trim().length > 0 && over <= 0;
  // Portaled: a size container (the welcome) is the containing block of its fixed descendants.
  return createPortal(<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
    onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="cloud-memory-title" aria-describedby="cloud-memory-intro" tabIndex={-1} data-cloud-memory={trouble ?? "new"}
      className="animate-pop-in flex max-h-[min(720px,calc(100dvh-2rem))] w-full max-w-[540px] flex-col gap-4 overflow-y-auto rounded-2xl border border-hairline/50 bg-panel p-6 shadow-2xl outline-none">
      <header className="flex flex-col gap-1.5">
        <h2 id="cloud-memory-title" className="text-[17px] font-semibold text-ink">{t("cloudWelcome.memory.title")}</h2>
        <p id="cloud-memory-intro" className="text-[13px] leading-relaxed text-ink-secondary">
          {t(trouble ? "cloudWelcome.memory.notAdded" : "cloudWelcome.memory.intro", { name })}
        </p>
      </header>
      {!trouble && <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium text-ink">{t("cloudWelcome.memory.ask")}</h3>
        <div className="flex items-start gap-2 rounded-xl border border-hairline/50 bg-inset px-3 py-2.5">
          <p data-memory-prompt className="min-w-0 flex-1 select-all text-[13.5px] leading-relaxed text-ink">{prompt}</p>
          <button type="button" onClick={copy.copy} className="ui-button ui-button-sm shrink-0" aria-live="polite">
            {copy.state === "copied" ? <Check size={13} aria-hidden="true" className="text-success" /> : <Copy size={13} aria-hidden="true" />}
            {copy.state === "copied" ? t("engineSetup.copied") : copy.state === "failed" ? t("common.copyFailed") : t("engineSetup.copy")}
          </button>
        </div>
      </section>}
      <section className="flex flex-col gap-2">
        <label htmlFor="cloud-memory-answer" className="text-[13px] font-medium text-ink">{t(trouble ? "cloudWelcome.memory.kept" : "cloudWelcome.memory.paste")}</label>
        <textarea id="cloud-memory-answer" autoFocus rows={6} value={memory} onChange={(event) => setMemory(event.target.value)}
          placeholder={t("cloudWelcome.memory.placeholder")}
          className="min-h-[132px] w-full resize-y rounded-xl border border-hairline/50 bg-inset px-3 py-2.5 text-[13.5px] leading-relaxed text-ink placeholder:text-ink-tertiary focus:border-accent/60 focus:outline-none" />
      </section>
      {memory.trim() && <section aria-labelledby="cloud-memory-preview" className="flex flex-col gap-2">
        <h3 id="cloud-memory-preview" className="text-[12px] font-medium text-ink-secondary">{t("cloudWelcome.memory.preview")}</h3>
        <div data-memory-preview className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-hairline/40 bg-app px-3 py-2.5 text-[12.5px] leading-relaxed">
          {before.trim() && <span className="text-ink-tertiary">{before.trimEnd()}{"\n\n"}</span>}
          <span className="text-ink">{memory.trim()}</span>
        </div>
      </section>}
      {over > 0 && <p role="alert" className="text-[12.5px] text-danger">{t("cloudWelcome.memory.tooLong", { count: new Intl.NumberFormat(activeLocale()).format(over) })}</p>}
      {trouble === "failed" && <p role="alert" className="text-[12.5px] text-danger">{t("cloudWelcome.memory.failed")}</p>}
      <footer className="flex flex-wrap items-center justify-end gap-2">
        {onDiscard && <button type="button" className={`${QUIET} mr-auto`} onClick={onDiscard}>{t("cloudWelcome.memory.discard")}</button>}
        <button type="button" className={SECONDARY} onClick={onClose}>{t(trouble ? "cloudWelcome.memory.later" : "common.cancel")}</button>
        <button type="button" className={PRIMARY} disabled={!ready} onClick={() => onAdd(memory.trim())}>{t("cloudWelcome.memory.add")}</button>
      </footer>
    </div>
  </div>, document.body);
}
