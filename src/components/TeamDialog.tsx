import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { api, useStore, type Bot } from "@/state/store";
import { BotPickerList } from "./BotPickerList";

/** A team may start empty; choosing bots moves their membership, never copies them. */
export function TeamDialog({ section, rename = false, onClose }: {
  section?: string;
  rename?: boolean;
  onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const [name, setName] = useState(section ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (dialog.current?.querySelector<HTMLElement>("input") ?? dialog.current?.querySelector<HTMLElement>("button"))?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  const title = rename ? "Rename empty team" : section ? `Move bots to ${section}` : "Create team";
  const candidates = state.bots.filter((bot) => !bot.hidden && (!section || bot.section?.trim() !== section));
  const save = async () => {
    if (saving || !name.trim() || (section && !rename && !picked.size)) return;
    if (!section && [...(state.sections ?? []), ...state.bots.map((bot) => bot.section), ...state.groups.map((group) => group.section)].includes(name.trim())) {
      setError("A team with that name already exists. Use Move bots on its team card.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result: { sections: string[]; bots?: Bot[] } = await api(
        rename ? `/api/sidebar-sections?section=${encodeURIComponent(section!)}` : "/api/sidebar-sections",
        { method: rename ? "PATCH" : "POST", body: JSON.stringify(rename ? { name: name.trim() } : { name: name.trim(), botIds: [...picked] }) },
      );
      dispatch({ type: "sections", sections: result.sections });
      for (const bot of result.bots ?? []) dispatch({ type: "botPatched", bot });
      onCloseRef.current();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="team-dialog-title"
        className="max-h-[90vh] w-full max-w-[430px] overflow-y-auto rounded-2xl border border-hairline/50 bg-panel p-5 text-ink shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !saving) { event.stopPropagation(); onClose(); }
          if (event.key === "Tab") {
            const controls = dialog.current?.querySelectorAll<HTMLElement>("input:enabled, button:enabled");
            if (!controls?.length) return;
            const first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        }}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="team-dialog-title" className="text-[17px] font-semibold">{title}</h2>
          <button aria-label="Close team dialog" disabled={saving} onClick={onClose} className="rounded-lg p-1.5 text-ink-secondary hover:bg-raised"><X size={18} /></button>
        </div>
        {(!section || rename) && <label className="mb-3 block text-[13px] text-ink-secondary">Team name
          <input value={name} maxLength={60} disabled={saving} onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void save(); }}
            className="mt-1 w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[14px] text-ink" />
        </label>}
        {!rename && <>
          <p className="mb-3 text-[13px] leading-relaxed text-ink-secondary">
            {section ? "Choose existing bots to move here." : "Start empty, or choose existing bots to move here."} Moving changes who they can work with and which shared instructions they read. Their chats stay with them.
          </p>
          <fieldset disabled={saving}>
            <legend className="mb-1 text-[12px] font-medium text-ink-secondary">Existing bots</legend>
            <BotPickerList bots={candidates} picked={picked} emptyHint="No other bots to move. You can add bots later." onToggle={(id) => setPicked((previous) => {
              const next = new Set(previous);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            })} />
          </fieldset>
        </>}
        {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button disabled={saving} onClick={onClose} className="rounded-lg px-3 py-2 text-[13px] text-ink-secondary hover:bg-raised">Cancel</button>
          <button disabled={saving || !name.trim() || Boolean(section && !rename && !picked.size)} onClick={() => void save()}
            className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40">
            {saving ? "Saving…" : rename ? "Save name" : section ? `Move ${picked.size || "selected"} bots` : "Create team"}
          </button>
        </div>
      </div>
    </div>, document.body,
  );
}
