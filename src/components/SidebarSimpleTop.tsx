import { PanelLeft, Search, X } from "lucide-react";
import type { Ref } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export const SIMPLE_TOP_BUTTON = "flex size-[30px] shrink-0 items-center justify-center rounded-full bg-raised/50 text-ink hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export const SIMPLE_RAIL_BUTTON = "flex size-9 shrink-0 items-center justify-center rounded-xl text-ink-secondary hover:bg-raised/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export function SidebarCollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-sidebar-collapse-toggle
      onClick={onToggle}
      aria-label={t(collapsed ? "sidebar.density.expand" : "sidebar.density.collapseAria")}
      aria-expanded={!collapsed}
      title={t(collapsed ? "sidebar.density.expand" : "sidebar.density.collapse")}
      className={collapsed ? SIMPLE_RAIL_BUTTON : "flex size-7 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"}
    >
      <PanelLeft size={17} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}

export function SidebarSearchToggle({ open, onToggle, ref }: { open: boolean; onToggle: () => void; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type="button"
      data-sidebar-search-toggle
      onClick={onToggle}
      aria-label={t("sidebar.searchAria")}
      aria-expanded={open}
      title={t("sidebar.searchAria")}
      className={cn(SIMPLE_TOP_BUTTON, open && "bg-raised")}
    >
      <Search size={15} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

export function SidebarSearchPill({ query, onQuery, onClose }: { query: string; onQuery: (query: string) => void; onClose: () => void }) {
  return (
    <div data-sidebar-search-pill className="px-3 pb-2 pt-0.5">
      <div className="flex h-[34px] items-center gap-2 rounded-full bg-raised/60 pl-3 pr-1.5 text-ink-secondary focus-within:ring-1 focus-within:ring-focus">
        <Search size={15} aria-hidden="true" className="shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            onClose();
          }}
          placeholder={t("sidebar.searchAria")}
          aria-label={t("sidebar.searchAria")}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-tertiary focus:outline-none"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label={t("sidebar.searchClose")}
          title={t("sidebar.searchClose")}
          className="flex size-6 shrink-0 items-center justify-center rounded-full text-ink-tertiary hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
