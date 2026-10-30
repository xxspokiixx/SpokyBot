import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Plug,
  RefreshCw,
  Search,
  Server,
  Trash2,
  XCircle,
} from "lucide-react";

import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import type { Connector, Plugin, SearchResult } from "../../shared/plugins-catalog";

export interface PluginsCatalogProps {
  embedded?: boolean;
  refreshKey?: number;
}

export function PluginsCatalog({ embedded = false, refreshKey = 0 }: PluginsCatalogProps) {
  const [query, setQuery] = useState("");
  const [plugins, setPlugins] = useState<SearchResult[] | null>(null);
  const [servers, setServers] = useState<Connector[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<Plugin | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const loadServers = useCallback(() => {
    return api<{ servers?: Connector[] }>("/api/plugins/servers")
      .then((result) => setServers(result.servers ?? []))
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const search = useCallback(() => {
    setLoading(true);
    setError(null);
    return api<{ plugins?: SearchResult[] }>(`/api/plugins/search?q=${encodeURIComponent(query)}`)
      .then((result) => setPlugins(result.plugins ?? []))
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => {
    void search();
  }, [search]);

  useEffect(() => {
    void loadServers();
  }, [loadServers, refreshKey]);

  const beginInstall = useCallback(async (pluginId: string) => {
    setBusyId(pluginId);
    setError(null);
    try {
      const pluginDetail = await api<Plugin>(`/api/plugins/${encodeURIComponent(pluginId)}`);
      if (pluginDetail.setupFields && pluginDetail.setupFields.length > 0) {
        setExpanded(pluginId);
        setDetail(pluginDetail);
        setValues({});
        return;
      }
      const result = await api<{ ok?: boolean; error?: string }>("/api/plugins/install", {
        method: "POST",
        body: JSON.stringify({ pluginId, values: {} }),
      });
      if (!result.ok) throw new Error(result.error ?? "Install failed");
      await Promise.all([search(), loadServers()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  }, [loadServers, search]);

  const submitInstall = useCallback(async () => {
    if (!expanded || !detail) return;
    setBusyId(expanded);
    setError(null);
    try {
      const result = await api<{ ok?: boolean; error?: string }>("/api/plugins/install", {
        method: "POST",
        body: JSON.stringify({ pluginId: expanded, values }),
      });
      if (!result.ok) throw new Error(result.error ?? "Install failed");
      setExpanded(null);
      setDetail(null);
      setValues({});
      await Promise.all([search(), loadServers()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  }, [detail, expanded, loadServers, search, values]);

  const uninstall = useCallback(async (pluginId: string) => {
    if (!window.confirm("Uninstall this plugin?")) return;
    setBusyId(pluginId);
    setError(null);
    try {
      const result = await api<{ ok?: boolean; error?: string }>("/api/plugins/uninstall", {
        method: "POST",
        body: JSON.stringify({ pluginId }),
      });
      if (!result.ok) throw new Error(result.error ?? "Uninstall failed");
      await Promise.all([search(), loadServers()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  }, [loadServers, search]);

  const authenticate = useCallback(async (serverId: string) => {
    setBusyId(serverId);
    setError(null);
    try {
      const result = await api<{ ok?: boolean; error?: string }>("/api/plugins/servers/authenticate", {
        method: "POST",
        body: JSON.stringify({ serverId, accountLabel: "default" }),
      });
      if (!result.ok) throw new Error(result.error ?? "Authentication failed");
      await loadServers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  }, [loadServers]);

  return (
    <div className={cn("flex flex-col gap-4", embedded ? "" : "mx-auto max-w-[840px]")}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[18px] font-semibold leading-6 text-ink">Plugins</h2>
        <button
          type="button"
          onClick={() => void Promise.all([search(), loadServers()])}
          disabled={loading}
          className="flex size-8 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-50"
          aria-label="Refresh plugins"
          title="Refresh plugins"
        >
          <RefreshCw size={16} className={cn(loading && "animate-spin")} />
        </button>
      </div>

      <label className="flex h-9 items-center gap-2.5 rounded-full bg-control/70 px-3.5 focus-within:ring-1 focus-within:ring-accent">
        <Search size={15} className="shrink-0 text-ink-secondary" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search plugins"
          aria-label="Search plugins"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none"
        />
      </label>

      {error && <div role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>}

      {loading && plugins === null && (
        <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-ink-secondary">
          <Loader2 size={14} className="animate-spin" /> Loading plugins…
        </div>
      )}

      <div className="flex flex-col gap-3">
        {(plugins ?? []).map((plugin) => {
          const installed = plugin.installed;
          const isBusy = busyId === plugin.id;
          const isExpanded = expanded === plugin.id;
          return (
            <div key={plugin.id} className="rounded-xl bg-card p-4 text-ink shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-control/60 text-ink-secondary">
                  <Plug size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-semibold leading-5 text-ink">{plugin.name}</span>
                    {installed && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                        <CheckCircle2 size={12} /> Installed
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[12.5px] leading-[18px] text-ink-secondary">{plugin.description}</div>
                  <div className="mt-1 text-[11.5px] text-ink-secondary">
                    {plugin.category} · {plugin.connectorCount} connector{plugin.connectorCount === 1 ? "" : "s"} · {plugin.skillCount} skill{plugin.skillCount === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {installed ? (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void uninstall(plugin.id)}
                      className="inline-flex h-8 items-center gap-2 rounded-full bg-control/80 px-3 text-[13px] font-medium leading-5 text-ink transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                    >
                      {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      Uninstall
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void beginInstall(plugin.id)}
                      className="inline-flex h-8 items-center gap-2 rounded-full bg-accent px-3 text-[13px] font-medium leading-5 text-accent-ink disabled:opacity-40"
                    >
                      {isBusy ? <Loader2 size={14} className="animate-spin" /> : null}
                      Install
                    </button>
                  )}
                </div>
              </div>

              {isExpanded && detail && (
                <form
                  className="mt-3 flex flex-col gap-2 border-t border-control/60 pt-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitInstall();
                  }}
                >
                  {detail.setupFields.map((field) => (
                    <label key={field.key} className="flex flex-col gap-1">
                      <span className="text-[12px] font-medium text-ink">{field.label}{field.required ? " *" : ""}</span>
                      <input
                        type={field.secret ? "password" : "text"}
                        value={values[field.key] ?? ""}
                        onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                        className="h-9 rounded-lg bg-inset px-3 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none focus:ring-1 focus:ring-accent"
                        required={field.required}
                      />
                    </label>
                  ))}
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={busyId === expanded}
                      className="inline-flex h-8 items-center gap-2 rounded-full bg-accent px-3 text-[13px] font-medium leading-5 text-accent-ink disabled:opacity-40"
                    >
                      {busyId === expanded ? <Loader2 size={14} className="animate-spin" /> : null}
                      Install
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setExpanded(null);
                        setDetail(null);
                        setValues({});
                      }}
                      className="inline-flex h-8 items-center rounded-full px-3 text-[13px] font-medium leading-5 text-ink-secondary hover:text-ink"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          );
        })}

        {plugins !== null && (plugins ?? []).length === 0 && !loading && (
          <div className="flex min-h-40 flex-col items-center justify-center text-center">
            <div className="text-[14px] font-medium text-ink">No plugins found</div>
            <div className="mt-1 text-[12.5px] text-ink-secondary">Try a different search.</div>
          </div>
        )}
      </div>

      <section className="mt-2">
        <h3 className="mb-2 text-[14px] font-semibold leading-5 text-ink">MCP server statuses</h3>
        {servers === null ? (
          <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <Loader2 size={14} className="animate-spin" /> Loading servers…
          </div>
        ) : servers.length === 0 ? (
          <div className="text-[12.5px] text-ink-secondary">No MCP servers.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {servers.map((server) => (
              <div key={server.serverId} className="flex items-center gap-3 rounded-xl bg-card px-3 py-2">
                <Server size={16} className="shrink-0 text-ink-secondary" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink">{server.displayName}</div>
                  <div className="text-[11.5px] text-ink-secondary">{server.transport}</div>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    server.status === "connected" ? "bg-success/10 text-success" : "bg-control/60 text-ink-secondary",
                  )}
                >
                  {server.status === "connected" ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                  {server.status}
                </span>
                {server.status !== "connected" && (
                  <button
                    type="button"
                    disabled={busyId === server.serverId}
                    onClick={() => void authenticate(server.serverId)}
                    className="inline-flex h-7 items-center gap-1 rounded-full bg-control/80 px-2 text-[12px] font-medium text-ink disabled:opacity-40"
                  >
                    {busyId === server.serverId ? <Loader2 size={12} className="animate-spin" /> : null}
                    Connect
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default PluginsCatalog;
