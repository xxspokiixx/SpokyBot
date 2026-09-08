import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, FolderPlus, Plus, X } from "lucide-react";
import { useStore, type Bot, type BotProject } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

/** Folders only organize threads. The project-shaped API is retained for
 * compatibility; neither model settings nor working directories live here. */
export function BotProjectDialog({ bot, project, onClose, onCreated }: {
  bot: Bot;
  project?: BotProject;
  onClose: () => void;
  onCreated?: (project: BotProject) => void;
}) {
  const { dispatch } = useStore();
  const [name, setName] = useState(project?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    nameRef.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  return createPortal(
    <div data-thread-overlay className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCloseRef.current(); }
        if (event.key !== "Tab") return;
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled])");
        if (!controls?.length) return;
        const first = controls[0]!;
        const last = controls[controls.length - 1]!;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t(project ? "folder.settings" : "folder.create")}
        className="max-h-[85dvh] w-full max-w-[420px] overflow-y-auto rounded-2xl border border-hairline/50 bg-panel p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-ink">{t(project ? "folder.settings" : "folder.create")}</h2>
          <button type="button" onClick={onClose} aria-label={t("folder.close")} className="rounded p-1 text-ink-secondary hover:bg-raised"><X size={16} /></button>
        </div>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || saving) return;
          if (project) {
            dispatch({ type: "updateProject", botId: bot.id, projectId: project.id, patch: { name: name.trim() } });
            onClose();
          } else {
            setSaving(true);
            dispatch({ type: "createProject", botId: bot.id, name: name.trim(), onError: () => setSaving(false),
              onCreated: (created) => { onCreated?.(created); onClose(); } });
          }
        }}>
          <label className="block text-[12px] text-ink-secondary">{t("folder.name")}
            <input ref={nameRef} value={name} maxLength={80} onChange={(event) => setName(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[13px] text-ink focus:border-accent/60 focus:outline-none" />
          </label>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{t("folder.detail", { name: bot.name })}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-[13px] text-ink-secondary hover:bg-raised">{t("common.cancel")}</button>
            <button type="submit" disabled={!name.trim() || saving} className="rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-white disabled:opacity-40">{t(project ? "folder.saveName" : saving ? "folder.creating" : "folder.create")}</button>
          </div>
        </form>
        {project && <div className="mt-4 border-t border-hairline/40 pt-3">
          {deleting ? <>
            <p className="text-[12px] leading-relaxed text-ink-secondary">{t("folder.deleteBody")}</p>
            <div className="mt-2 flex items-center gap-3">
              <button type="button" onClick={() => { dispatch({ type: "deleteProject", botId: bot.id, projectId: project.id }); onClose(); }} className="text-[12px] text-danger hover:underline">{t("folder.deleteConfirm")}</button>
              <button type="button" onClick={() => setDeleting(false)} className="text-[12px] text-ink-secondary hover:underline">{t("common.cancel")}</button>
            </div>
          </> : <button type="button" onClick={() => setDeleting(true)} className="text-[12px] text-danger hover:underline">{t("folder.delete")}</button>}
        </div>}
      </div>
    </div>, document.body,
  );
}

/** One-click new thread in the current folder; the arrow chooses a folder.
 * The popover escapes the sidebar/picker. */
export function NewThreadButton({ bot, className, compact = false, onCreated }: { bot: Bot; className?: string; compact?: boolean; onCreated?: () => void }) {
  const { dispatch } = useStore();
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const projects = bot.projects ?? [];
  const currentProject = projects.find((project) => project.id === bot.tasks?.find((task) => task.threadId === bot.threadId)?.projectId);
  const newThread = (projectId?: string) => {
    dispatch({ type: "newTask", botId: bot.id, ...(projectId ? { projectId } : {}) });
    setMenu(null);
    onCreated?.();
  };
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setMenu(null);
    };
    window.addEventListener("mousedown", outside);
    return () => window.removeEventListener("mousedown", outside);
  }, [menu]);
  return <>
    <div ref={rootRef} className={cn("flex items-center rounded-lg text-[12px] text-ink-secondary", className)}>
      <button type="button" onClick={() => newThread(currentProject?.id)} title={currentProject ? t("task.newIn", { name: currentProject.name }) : t("task.newShort")}
        className={cn("flex min-w-0 flex-1 items-center gap-2 rounded-l-[inherit] px-2.5 text-left hover:bg-raised/60 hover:text-ink", compact ? "py-1 @max-4xl/chathead:h-[30px] @max-4xl/chathead:px-2" : "py-2")}><Plus size={12} /> <span className={cn("truncate", compact && "@max-4xl/chathead:hidden")}>{t("task.newShort")}</span></button>
      <button type="button" aria-label={t("folder.choose")} aria-expanded={Boolean(menu)} onClick={() => {
        const rect = rootRef.current?.getBoundingClientRect();
        if (menu || !rect) { setMenu(null); return; }
        setMenu({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 248)), top: Math.min(rect.bottom + 4, Math.max(8, window.innerHeight - 300)) });
      }} className="self-stretch rounded-r-[inherit] px-2 hover:bg-raised/60 hover:text-ink"><ChevronDown size={12} /></button>
    </div>
    {menu && createPortal(<div ref={menuRef} data-thread-overlay className="fixed z-50 max-h-[280px] w-[240px] overflow-y-auto rounded-xl border border-hairline/50 bg-card p-1 shadow-2xl" style={menu}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setMenu(null); rootRef.current?.querySelectorAll<HTMLButtonElement>("button")[1]?.focus(); } }}>
      <p className="px-2.5 py-1.5 text-[11px] text-ink-secondary">{t("folder.newIn")}</p>
      {[{ id: "", name: t("folder.none") }, ...projects].map((project) => <button key={project.id} type="button" onClick={() => newThread(project.id || undefined)}
        className="block w-full truncate rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-raised">{project.name}</button>)}
      <button type="button" onClick={() => { setMenu(null); setCreatingProject(true); }} className="mt-1 flex w-full items-center gap-2 border-t border-hairline/40 px-2.5 py-2 text-[12px] text-ink-secondary hover:bg-raised"><FolderPlus size={13} /> {t("folder.create")}…</button>
    </div>, document.body)}
    {creatingProject && <BotProjectDialog bot={bot} onClose={() => setCreatingProject(false)} onCreated={(project) => newThread(project.id)} />}
  </>;
}
