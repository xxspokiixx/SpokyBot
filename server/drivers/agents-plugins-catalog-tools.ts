// Tool definitions exposing the plugins & skills catalog (13 operations) to the assistant.
// Dispatch is handled by the server tool runtime via the service in server/plugins-catalog.ts.
export const PLUGINS_CATALOG_TOOL_DEFINITIONS = [
  { name: "SearchPlugins", description: "Search the plugins catalog. Omitted query lists all.", inputSchema: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false } },
  { name: "GetPlugin", description: "Full detail for a plugin by id.", inputSchema: { type: "object", properties: { plugin_id: { type: "string" } }, required: ["plugin_id"], additionalProperties: false } },
  { name: "InstallPlugin", description: "Install a plugin, with optional setup values.", inputSchema: { type: "object", properties: { plugin_id: { type: "string" }, values: { type: "object" } }, required: ["plugin_id"], additionalProperties: false } },
  { name: "UninstallPlugin", description: "Uninstall a plugin (full scope).", inputSchema: { type: "object", properties: { plugin_id: { type: "string" } }, required: ["plugin_id"], additionalProperties: false } },
  { name: "GetMcpServerStatus", description: "List installed MCP servers with status.", inputSchema: { type: "object", properties: { server_id: { type: "string" } }, additionalProperties: false } },
  { name: "AuthenticateMcpServer", description: "Authenticate or grant an MCP server account.", inputSchema: { type: "object", properties: { server_id: { type: "string" }, account_label: { type: "string" }, force_reauth: { type: "boolean" } }, required: ["server_id", "account_label"], additionalProperties: false } },
  { name: "AddMcpServer", description: "Add a custom MCP server.", inputSchema: { type: "object", properties: { name: { type: "string" }, url: { type: "string" }, command: { type: "string" }, args: { type: "array", items: { type: "string" } }, env: { type: "object" }, headers: { type: "object" } }, required: ["name"], additionalProperties: false } },
  { name: "UninstallMcpServer", description: "Remove a custom MCP server.", inputSchema: { type: "object", properties: { server_id: { type: "string" } }, required: ["server_id"], additionalProperties: false } },
  { name: "RemoveMcpAccount", description: "Remove one account from a server.", inputSchema: { type: "object", properties: { server_id: { type: "string" }, account: { type: "string" } }, required: ["server_id", "account"], additionalProperties: false } },
  { name: "RenameMcpAccount", description: "Rename an account label.", inputSchema: { type: "object", properties: { server_id: { type: "string" }, account: { type: "string" }, new_label: { type: "string" } }, required: ["server_id", "account", "new_label"], additionalProperties: false } },
  { name: "SetMcpInstructions", description: "Set custom instructions for a server.", inputSchema: { type: "object", properties: { server_id: { type: "string" }, text: { type: ["string", "null"] } }, required: ["server_id"], additionalProperties: false } },
  { name: "RestartMcpServers", description: "Restart all MCP servers.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "GetDynamicTools", description: "Get tool schemas for a namespace (server id).", inputSchema: { type: "object", properties: { namespace: { type: "string" } }, required: ["namespace"], additionalProperties: false } },
];
