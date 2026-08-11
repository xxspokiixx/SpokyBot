import { useState } from "react";
import { X, Globe, FileText, Calendar, Terminal, Image } from "lucide-react";
import { useStore } from "@/state/store";
import { cn } from "@/lib/cn";

const PLUGINS = [
  { id: "web", name: "Web Search", desc: "Let bots search the web", icon: Globe },
  { id: "files", name: "Files", desc: "Read and write local files", icon: FileText },
  { id: "calendar", name: "Calendar", desc: "See and manage your schedule", icon: Calendar },
  { id: "shell", name: "Terminal", desc: "Run commands on this Mac", icon: Terminal },
  { id: "images", name: "Images", desc: "Generate and edit images", icon: Image },
];

export function PluginsPanel() {
  const { dispatch } = useStore();
  const [enabled, setEnabled] = useState<Record<string, boolean>>({ web: true });

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/40"
      onClick={() => dispatch({ type: "togglePlugins", open: false })}
    >
      <div
        className="w-[520px] rounded-2xl border border-hairline/50 bg-panel p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-[17px] font-semibold text-ink">Plugins</div>
          <button
            onClick={() => dispatch({ type: "togglePlugins", open: false })}
            className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>
        <div className="mt-1 text-[13px] text-ink-secondary">
          Capabilities your bots can use. Wiring comes next — toggles are local
          for now.
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-hairline/40">
          {PLUGINS.map((p, i) => {
            const on = !!enabled[p.id];
            return (
              <div
                key={p.id}
                className={cn(
                  "flex items-center gap-3 bg-card px-4 py-3",
                  i > 0 && "border-t border-hairline/40",
                )}
              >
                <p.icon size={18} className="shrink-0 text-ink-secondary" />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-ink">{p.name}</div>
                  <div className="text-[12px] text-ink-secondary">{p.desc}</div>
                </div>
                <button
                  role="switch"
                  aria-checked={on}
                  onClick={() => setEnabled((s) => ({ ...s, [p.id]: !on }))}
                  className={cn(
                    "relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors",
                    on ? "bg-accent" : "bg-raised",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-[3px] size-4 rounded-full bg-white transition-all",
                      on ? "left-[18px]" : "left-[3px]",
                    )}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
