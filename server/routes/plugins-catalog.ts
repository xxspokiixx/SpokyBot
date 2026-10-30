import {
  searchCatalog,
  getPlugin,
  installPlugin,
  uninstallPlugin,
  getMcpServerStatus,
  authenticateMcpServer,
  addMcpServer,
  uninstallMcpServer,
  removeMcpAccount,
  renameMcpAccount,
  setMcpInstructions,
  restartMcpServers,
} from "../plugins-catalog.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createPluginsCatalogRoutes(): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (method === "GET" && path === "/api/plugins/search") {
      const q = url.searchParams.get("q") ?? undefined;
      const userId = (req.headers["x-user-id"] as string) ?? "default";
      return json(res, 200, { plugins: searchCatalog(userId, q) });
    }
    const pluginDetail = /^\/api\/plugins\/([^/]+)$/.exec(path);
    if (method === "GET" && pluginDetail) {
      const p = getPlugin(pluginDetail[1]!);
      if (!p) return json(res, 404, { error: "not found" });
      return json(res, 200, p);
    }
    if (method === "POST" && path === "/api/plugins/install") {
      const body = await readBody(req);
      const userId = (req.headers["x-user-id"] as string) ?? "default";
      const result = installPlugin(userId, String(body?.pluginId ?? ""), body?.values ?? {});
      return json(res, result.ok ? 200 : 400, result);
    }
    if (method === "POST" && path === "/api/plugins/uninstall") {
      const body = await readBody(req);
      const userId = (req.headers["x-user-id"] as string) ?? "default";
      const result = uninstallPlugin(userId, String(body?.pluginId ?? ""));
      return json(res, result.ok ? 200 : 400, result);
    }
    if (method === "GET" && path === "/api/plugins/servers") {
      const sid = url.searchParams.get("serverId") ?? undefined;
      return json(res, 200, { servers: getMcpServerStatus(sid) });
    }
    if (method === "POST" && path === "/api/plugins/servers/authenticate") {
      const body = await readBody(req);
      const result = authenticateMcpServer(String(body?.serverId), String(body?.accountLabel ?? "default"), Boolean(body?.forceReauth));
      return json(res, result.ok ? 200 : 400, result);
    }
    if (method === "POST" && path === "/api/plugins/servers/add") {
      const body = await readBody(req);
      const result = addMcpServer({
        name: String(body?.name ?? ""),
        url: body?.url,
        command: body?.command,
        args: body?.args,
        env: body?.env,
        headers: body?.headers,
      });
      return json(res, result.ok ? 201 : 400, result);
    }
    const removeServer = /^\/api\/plugins\/servers\/([^/]+)$/.exec(path);
    if (method === "DELETE" && removeServer) {
      const result = uninstallMcpServer(removeServer[1]!);
      return json(res, result.ok ? 200 : 400, result);
    }
    if (method === "POST" && path === "/api/plugins/servers/remove-account") {
      const body = await readBody(req);
      const result = removeMcpAccount(String(body?.serverId), String(body?.account));
      return json(res, result.ok ? 200 : 400, result);
    }
    if (method === "POST" && path === "/api/plugins/servers/rename-account") {
      const body = await readBody(req);
      const result = renameMcpAccount(String(body?.serverId), String(body?.account), String(body?.newLabel));
      return json(res, result.ok ? 200 : 400, result);
    }
    if (method === "POST" && path === "/api/plugins/servers/instructions") {
      const body = await readBody(req);
      const result = setMcpInstructions(String(body?.serverId), body?.text ?? null);
      return json(res, result.ok ? 200 : 400, result);
    }
    if (method === "POST" && path === "/api/plugins/servers/restart") {
      return json(res, 200, restartMcpServers());
    }
    return PASS;
  };
}
