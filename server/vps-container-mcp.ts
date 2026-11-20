// Stdio bridge to the Cua MCP server in a VPS container; auth is the user's SSH config and agent, and nothing is stored here.
import { runMcpBridge } from "./mcp-bridge.ts";
import { vpsContainerMcpLaunch } from "./vps-computer.ts";

const [alias, containerName] = process.argv.slice(2);
const sshAlias = alias ?? "";

let launch: Awaited<ReturnType<typeof vpsContainerMcpLaunch>>;
try {
  launch = await vpsContainerMcpLaunch(sshAlias, containerName ?? "");
} catch {
  process.stderr.write("invalid VPS MCP connection\n");
  process.exit(2);
}

// The driving pair rides in env, not argv: argv is world-readable through `ps`.
const controlUrl = process.env.OMB_CONTROL_URL ?? "";
const controlToken = process.env.OMB_CONTROL_TOKEN ?? "";

runMcpBridge({
  command: launch.command,
  args: launch.args,
  env: launch.env,
  label: "VPS Cua Driver",
  liveness: launch.liveness,
  ...(controlUrl && controlToken ? { gate: { url: controlUrl, token: controlToken } } : {}),
});
