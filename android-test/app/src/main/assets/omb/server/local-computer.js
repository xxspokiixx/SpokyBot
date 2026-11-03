import { createRequire as __ombCreateRequire } from "node:module";
const require = __ombCreateRequire(import.meta.url);

// server/local-computer.ts
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname as dirname2, isAbsolute, join as join2 } from "node:path";

// server/proxy-paths.ts
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
var SERVER_ROOT = dirname(fileURLToPath(import.meta.url));
function resolveProxy(relative) {
  const source = join(SERVER_ROOT, `${relative}.ts`);
  return existsSync(source) ? source : join(SERVER_ROOT, `${relative}.js`);
}
var SPAWNED_PROXIES = {
  harnessMcp: resolveProxy("harness-mcp-proxy"),
  localComputer: resolveProxy("local-computer-proxy"),
  permission: resolveProxy("permission-proxy"),
  containerMcp: resolveProxy("container-mcp"),
  vpsContainerMcp: resolveProxy("vps-container-mcp"),
  agents: resolveProxy("drivers/agents-proxy"),
  dweb: resolveProxy("drivers/dweb-proxy"),
  connectors: resolveProxy("connector-proxy"),
  mcpGate: resolveProxy("mcp-gate"),
  mcpRemote: resolveProxy("mcp-remote-proxy"),
  phone: resolveProxy("drivers/phone-proxy"),
  hook: resolveProxy("hooks/omb-hook"),
  piMcpExtension: resolveProxy("drivers/pi-mcp-extension")
};

// server/local-computer.ts
var REQUIRED_LINUX_TOOLS = ["click", "get_window_state", "list_apps", "type_text"];
var DRIVER_FILE_IDENTITY_KEYS = [
  "dev",
  "ino",
  "uid",
  "gid",
  "mode",
  "size",
  "mtimeNs",
  "ctimeNs"
];
function gatedLocalComputer(connection, control) {
  return {
    ...connection,
    command: process.execPath,
    args: ["--experimental-strip-types", SPAWNED_PROXIES.localComputer],
    env: {
      ...connection.env,
      // Packaged, execPath is Electron: without this the MCP client relaunches OMB instead of the headless gate.
      ELECTRON_RUN_AS_NODE: "1",
      OMB_CUA_COMMAND: connection.command,
      // The android phone lane's command is the node runtime itself, whose first
      // argument is the entry script, so the descriptor's "mcp" contract tag must
      // not reach argv; the desktop CUA binary takes that tag as its subcommand.
      OMB_CUA_ARGS: JSON.stringify(connection.platform === "android" ? connection.args.slice(1) : connection.args),
      OMB_CONTROL_URL: control.url,
      OMB_CONTROL_TOKEN: control.token
    }
  };
}
function exactKeys(value, keys) {
  const expected = new Set(keys);
  return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key));
}
function legacyPlatform(platform) {
  if (platform === "darwin" || platform === "win32" || platform === "android") return platform;
  return null;
}
function validDriverFileIdentity(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && exactKeys(value, DRIVER_FILE_IDENTITY_KEYS) && DRIVER_FILE_IDENTITY_KEYS.every(
    (key) => typeof value[key] === "string" && /^\d+$/.test(value[key])
  );
}
function currentDriverFileIdentity(file) {
  const stat = statSync(file, { bigint: true });
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    uid: String(stat.uid),
    gid: String(stat.gid),
    mode: String(stat.mode),
    size: String(stat.size),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs)
  };
}
function sameDriverFileIdentity(expected, actual) {
  return validDriverFileIdentity(expected) && DRIVER_FILE_IDENTITY_KEYS.every((key) => expected[key] === actual[key]);
}
function decodeLegacyDescriptor(value, platform) {
  const supportedPlatform = legacyPlatform(platform);
  if (!supportedPlatform || !value || !(value.mode === "embedded" || supportedPlatform === "darwin" && value.mode === "standalone") || Object.hasOwn(value, "status") && value.status !== "ready" || typeof value.socketPath !== "string" || !value.socketPath || typeof value.mcpCommand !== "string" || !value.mcpCommand.trim()) {
    return null;
  }
  if (!Array.isArray(value.mcpArgs) || value.mcpArgs[0] !== "mcp") return null;
  if (!value.mcpEnv || typeof value.mcpEnv !== "object" || Array.isArray(value.mcpEnv)) return null;
  const args = value.mcpArgs;
  if (!args.every((arg) => typeof arg === "string")) return null;
  const env = value.mcpEnv;
  if (!Object.values(env).every((entry) => typeof entry === "string")) return null;
  return {
    command: value.mcpCommand,
    args,
    env,
    platform: supportedPlatform,
    scope: "local-computer"
  };
}
function decodeLinuxDescriptor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const x11 = value.mode === "linux-x11-supervised" && value.session === "x11";
  const wayland = value.mode === "linux-wayland-gnome-supervised" && value.session === "wayland" && value.compositor === "gnome-mutter";
  const descriptorKeys = [
    "schemaVersion",
    "mode",
    "platform",
    "session",
    "enabled",
    "status",
    "ownerPid",
    "generation",
    "driver",
    "daemon",
    "mcp",
    "toolNames",
    "doctorWarnings",
    ...wayland ? ["compositor"] : []
  ];
  if (!x11 && !wayland || !exactKeys(value, descriptorKeys) || value.schemaVersion !== 1 || value.platform !== "linux" || value.enabled !== true || value.status !== "ready" || !Number.isInteger(value.ownerPid) || value.ownerPid <= 0 || typeof value.generation !== "string" || !/^[0-9a-f-]{32,64}$/i.test(value.generation)) {
    return null;
  }
  const driver = value.driver;
  const daemon = value.daemon;
  const mcp = value.mcp;
  if (!driver || !daemon || !mcp || Array.isArray(driver) || Array.isArray(daemon) || Array.isArray(mcp) || !exactKeys(driver, ["path", "version", "source", "manifestSchema", "fileIdentity"]) || !exactKeys(daemon, [
    "socketPath",
    "pid",
    "contractVersion",
    "toolsListSchemaVersion",
    "capabilityVersion",
    "mcpProtocolVersion"
  ]) || !exactKeys(mcp, ["command", "args", "env"])) {
    return null;
  }
  if (typeof driver.path !== "string" || !isAbsolute(driver.path) || driver.version !== "0.19.3" || !["bundled", "environment", "user-local", "path"].includes(String(driver.source)) || driver.manifestSchema !== "1" || !validDriverFileIdentity(driver.fileIdentity) || typeof daemon.socketPath !== "string" || !isAbsolute(daemon.socketPath) || !Number.isInteger(daemon.pid) || daemon.pid <= 0 || daemon.contractVersion !== "0.6.0" || daemon.toolsListSchemaVersion !== "1" || daemon.capabilityVersion !== "1" || daemon.mcpProtocolVersion !== "2025-06-18" || mcp.command !== driver.path || !Array.isArray(mcp.args) || mcp.args.length !== 4 || mcp.args[0] !== "mcp" || mcp.args[1] !== "--embedded" || mcp.args[2] !== "--socket" || mcp.args[3] !== daemon.socketPath || !mcp.env || typeof mcp.env !== "object" || Array.isArray(mcp.env) || !exactKeys(mcp.env, [
    "CUA_DRIVER_EMBEDDED",
    "CUA_DRIVER_HOST_BUNDLE_ID",
    "CUA_DRIVER_RS_UPDATE_CHECK",
    "CUA_DRIVER_RS_TELEMETRY_ENABLED",
    ...wayland ? ["CUA_DRIVER_RS_ENABLE_WAYLAND"] : []
  ]) || mcp.env.CUA_DRIVER_EMBEDDED !== "1" || mcp.env.CUA_DRIVER_HOST_BUNDLE_ID !== "com.openmausbot.app" || mcp.env.CUA_DRIVER_RS_UPDATE_CHECK !== "false" || mcp.env.CUA_DRIVER_RS_TELEMETRY_ENABLED !== "false" || wayland && mcp.env.CUA_DRIVER_RS_ENABLE_WAYLAND !== "1") {
    return null;
  }
  if (!Array.isArray(value.toolNames) || value.toolNames.some((name) => typeof name !== "string") || REQUIRED_LINUX_TOOLS.some((name) => !value.toolNames.includes(name)) || !Array.isArray(value.doctorWarnings)) {
    return null;
  }
  for (const warning of value.doctorWarnings) {
    if (!warning || typeof warning !== "object" || Array.isArray(warning) || ![3, 4].includes(Object.keys(warning).length) || !Object.keys(warning).every((key) => ["label", "status", "message", "detail"].includes(key)) || typeof warning.label !== "string" || warning.status !== "warn" || typeof warning.message !== "string" || warning.detail !== void 0 && typeof warning.detail !== "string") {
      return null;
    }
  }
  return {
    command: driver.path,
    args: [...mcp.args],
    env: { ...mcp.env },
    platform: "linux",
    generation: value.generation,
    scope: "local-computer"
  };
}
function descriptorUid() {
  const getuid = process.getuid;
  if (typeof getuid === "function") {
    const uid = getuid.call(process);
    if (uid >= 0) return uid;
  }
  try {
    return statSync(homedir()).uid;
  } catch {
    return -1;
  }
}
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function ownedPrivate(stat, uid) {
  return (stat.uid === uid || stat.uid === 0) && (stat.mode & 63) === 0;
}
function validateLinuxDescriptorRuntime(descriptorFile, raw, {
  uid = descriptorUid(),
  isProcessAlive = processAlive
} = {}) {
  try {
    const descriptorStat = lstatSync(descriptorFile);
    const descriptorDirectoryStat = lstatSync(dirname2(descriptorFile));
    if (!descriptorStat.isFile() || descriptorStat.isSymbolicLink() || !ownedPrivate(descriptorStat, uid) || !descriptorDirectoryStat.isDirectory() || descriptorDirectoryStat.isSymbolicLink() || !ownedPrivate(descriptorDirectoryStat, uid)) {
      return false;
    }
    const driver = raw.driver;
    const daemon = raw.daemon;
    const binaryPath = driver.path;
    const socketPath = daemon.socketPath;
    const binaryStat = statSync(binaryPath);
    const currentFileIdentity = currentDriverFileIdentity(binaryPath);
    const socketStat = lstatSync(socketPath);
    const socketDirectoryStat = lstatSync(dirname2(socketPath));
    if (realpathSync(binaryPath) !== binaryPath || !sameDriverFileIdentity(driver.fileIdentity, currentFileIdentity) || !binaryStat.isFile() || binaryStat.uid !== uid && binaryStat.uid !== 0 || (binaryStat.mode & 73) === 0 || (binaryStat.mode & 18) !== 0 || !socketStat.isSocket() || socketStat.isSymbolicLink() || !ownedPrivate(socketStat, uid) || !socketDirectoryStat.isDirectory() || socketDirectoryStat.isSymbolicLink() || !ownedPrivate(socketDirectoryStat, uid) || !isProcessAlive(raw.ownerPid) || !isProcessAlive(daemon.pid)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
function validateLegacyDescriptorRuntime(descriptorFile, platform, { uid = descriptorUid() } = {}) {
  try {
    const stat = lstatSync(descriptorFile);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    if (platform !== "win32" && (stat.uid !== uid || (stat.mode & 18) !== 0)) return false;
    return true;
  } catch {
    return false;
  }
}
function firstPresentCuaDescriptor(candidates) {
  for (const file of new Set(candidates)) {
    try {
      lstatSync(file);
      return file;
    } catch (error) {
      if (error.code !== "ENOENT") return file;
    }
  }
  return null;
}
function readCuaConnection({
  platform = process.platform,
  userData = process.env.OMB_USER_DATA,
  home = homedir(),
  validateLinuxRuntime = validateLinuxDescriptorRuntime,
  validateLegacyRuntime = validateLegacyDescriptorRuntime
} = {}) {
  const candidates = userData ? [join2(userData, "cua-connection.json")] : [];
  if (platform === "darwin" && !userData) {
    for (const directory of ["SpokyBot", "openmausbot", "OpenGrokBot", "opengrokbot"]) {
      candidates.push(join2(home, "Library", "Application Support", directory, "cua-connection.json"));
    }
  }
  const file = firstPresentCuaDescriptor(candidates);
  if (!file) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    if (platform === "linux") {
      const decoded = decodeLinuxDescriptor(raw);
      if (decoded && validateLinuxRuntime(file, raw)) return decoded;
    } else {
      const decoded = decodeLegacyDescriptor(raw, platform);
      if (decoded && validateLegacyRuntime(file, platform)) return decoded;
    }
  } catch {
  }
  return null;
}
function readCuaUnavailableReason({
  platform = process.platform,
  userData = process.env.OMB_USER_DATA,
  home = homedir()
} = {}) {
  if (!legacyPlatform(platform)) return null;
  const candidates = userData ? [join2(userData, "cua-connection.json")] : [];
  if (platform === "darwin" && !userData) {
    for (const directory of ["SpokyBot", "openmausbot", "OpenGrokBot", "opengrokbot"]) {
      candidates.push(join2(home, "Library", "Application Support", directory, "cua-connection.json"));
    }
  }
  const file = firstPresentCuaDescriptor(candidates);
  if (!file) return null;
  try {
    if (validateLegacyDescriptorRuntime(file, platform)) {
      const raw = JSON.parse(readFileSync(file, "utf8"));
      if (raw && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length === 2 && raw.mode === "unavailable") {
        const reason = raw.reason;
        if (typeof reason === "string" && reason.trim() && reason.length <= 2e3) return reason.trim();
      }
    }
  } catch {
  }
  return null;
}
export {
  DRIVER_FILE_IDENTITY_KEYS,
  REQUIRED_LINUX_TOOLS,
  decodeLinuxDescriptor,
  descriptorUid,
  gatedLocalComputer,
  readCuaConnection,
  readCuaUnavailableReason,
  validateLinuxDescriptorRuntime
};
