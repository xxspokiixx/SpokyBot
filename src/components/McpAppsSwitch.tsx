// Settings → MCP servers: "Show its apps in chat", per server
// (docs/superpowers/specs/2026-10-14-chat-apps-design.md, Decision 13). On by
// default. Off, the server is mounted exactly as it was before apps: no app
// UI advertised, no app rows. Drawn only for a server whose listing reports
// `apps` (server/routes/mcp-servers.ts), so a server that cannot say stays
// as it was, and only once the app catalog has seen it offer an app
// (`hasApps`), or while it is switched off so it can be switched back on.
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { Switch } from "./SettingsPrimitives";

export function McpAppsSwitch<T>({ server, disabled, onSaved }: {
  server: { name: string; apps?: boolean; hasApps?: boolean };
  disabled: boolean;
  /** The listing the server answers with, as every other change does. */
  onSaved(servers: T[]): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (typeof server.apps !== "boolean") return null;
  if (server.apps && server.hasApps !== true) return null;
  const on = server.apps;
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ servers?: T[] }>(`/api/mcp/servers/${encodeURIComponent(server.name)}`, { method: "PATCH", body: JSON.stringify({ apps: !on }) });
      onSaved(result.servers ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-mcp-apps={server.name} className="mt-3 flex items-center gap-3 border-t border-hairline/40 pt-3">
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-ink">{t("mcp.apps.title")}</div>
        <div role={error ? "alert" : undefined} className={error ? "mt-0.5 text-[11.5px] text-danger" : "mt-0.5 text-[11.5px] text-ink-secondary"}>{error ?? t("mcp.apps.desc")}</div>
      </div>
      {busy && <Loader2 aria-hidden="true" size={13} className="animate-spin text-ink-secondary" />}
      <Switch checked={on} disabled={disabled || busy} onClick={() => void toggle()} aria-label={t("mcp.apps.toggleAria", { name: server.name })} className="disabled:opacity-40" />
    </div>
  );
}
