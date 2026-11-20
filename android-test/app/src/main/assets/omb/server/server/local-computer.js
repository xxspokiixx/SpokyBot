import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { SPAWNED_PROXIES } from "./proxy-paths.js";
export const REQUIRED_LINUX_TOOLS = ["click", "get_window_state", "list_apps", "type_text"];
// Keep in sync with DRIVER_FILE_IDENTITY_KEYS in electron/cua-linux.cjs: Electron publishes it, the server revalidates it.
export const DRIVER_FILE_IDENTITY_KEYS = [
    "dev",
    "ino",
    "uid",
    "gid",
    "mode",
    "size",
    "mtimeNs",
    "ctimeNs",
];
/** `journal`: the bridge records each computer call for saved steps. */
export function gatedLocalComputer(connection, control, journal = false) {
    return {
        ...connection,
        command: process.execPath,
        args: ["--experimental-strip-types", SPAWNED_PROXIES.localComputer],
        env: {
            ...connection.env,
            // Packaged, execPath is Electron: without this the MCP client relaunches OMB instead of the headless gate.
            ELECTRON_RUN_AS_NODE: "1",
            OMB_CUA_COMMAND: connection.command,
            OMB_CUA_ARGS: JSON.stringify(connection.args),
            OMB_CUA_PLATFORM: connection.platform,
            OMB_CONTROL_URL: control.url,
            OMB_CONTROL_TOKEN: control.token,
            OMB_COMPUTER_JOURNAL: journal ? "1" : "0",
        },
    };
}
function exactKeys(value, keys) {
    const expected = new Set(keys);
    return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key));
}
function legacyPlatform(platform) {
    if (platform === "darwin" || platform === "win32")
        return platform;
    return null;
}
function validDriverFileIdentity(value) {
    return (Boolean(value) &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        exactKeys(value, DRIVER_FILE_IDENTITY_KEYS) &&
        DRIVER_FILE_IDENTITY_KEYS.every((key) => typeof value[key] === "string" && /^\d+$/.test(value[key])));
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
        ctimeNs: String(stat.ctimeNs),
    };
}
function sameDriverFileIdentity(expected, actual) {
    return (validDriverFileIdentity(expected) &&
        DRIVER_FILE_IDENTITY_KEYS.every((key) => expected[key] === actual[key]));
}
function decodeLegacyDescriptor(value, platform) {
    const supportedPlatform = legacyPlatform(platform);
    if (!supportedPlatform || !value ||
        !(value.mode === "embedded" || (supportedPlatform === "darwin" && value.mode === "standalone")) ||
        (Object.hasOwn(value, "status") && value.status !== "ready") ||
        typeof value.socketPath !== "string" || !value.socketPath ||
        typeof value.mcpCommand !== "string" || !value.mcpCommand.trim()) {
        return null;
    }
    if (!Array.isArray(value.mcpArgs) || value.mcpArgs[0] !== "mcp")
        return null;
    if (!value.mcpEnv || typeof value.mcpEnv !== "object" || Array.isArray(value.mcpEnv))
        return null;
    const args = value.mcpArgs;
    if (!args.every((arg) => typeof arg === "string"))
        return null;
    const env = value.mcpEnv;
    if (!Object.values(env).every((entry) => typeof entry === "string"))
        return null;
    return {
        command: value.mcpCommand,
        args,
        env: env,
        platform: supportedPlatform,
        scope: "local-computer",
    };
}
/** The phone writes the same embedded shape as the desktop driver, but its MCP server is a plain
 * node script run as `<node> <script> mcp`. The descriptor keeps the Cua-style `["mcp", script]`
 * order, so the script is moved ahead of the subcommand for node to load it. */
function decodeAndroidDescriptor(value) {
    if (!value || value.mode !== "embedded" ||
        (Object.hasOwn(value, "status") && value.status !== "ready") ||
        typeof value.socketPath !== "string" || !value.socketPath ||
        typeof value.mcpCommand !== "string" || !value.mcpCommand.trim()) {
        return null;
    }
    if (!Array.isArray(value.mcpArgs) || value.mcpArgs[0] !== "mcp" ||
        typeof value.mcpArgs[1] !== "string" || !value.mcpArgs[1].trim() ||
        !value.mcpArgs.every((arg) => typeof arg === "string")) {
        return null;
    }
    if (!value.mcpEnv || typeof value.mcpEnv !== "object" || Array.isArray(value.mcpEnv) ||
        !Object.values(value.mcpEnv).every((entry) => typeof entry === "string")) {
        return null;
    }
    return {
        command: value.mcpCommand,
        args: [value.mcpArgs[1], "mcp"],
        env: value.mcpEnv,
        platform: "android",
        scope: "local-computer",
    };
}
export function decodeLinuxDescriptor(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const x11 = value.mode === "linux-x11-supervised" && value.session === "x11";
    const wayland = value.mode === "linux-wayland-gnome-supervised" &&
        value.session === "wayland" &&
        value.compositor === "gnome-mutter";
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
        ...(wayland ? ["compositor"] : []),
    ];
    if ((!x11 && !wayland) ||
        !exactKeys(value, descriptorKeys) ||
        value.schemaVersion !== 1 ||
        value.platform !== "linux" ||
        value.enabled !== true ||
        value.status !== "ready" ||
        !Number.isInteger(value.ownerPid) ||
        value.ownerPid <= 0 ||
        typeof value.generation !== "string" ||
        !/^[0-9a-f-]{32,64}$/i.test(value.generation)) {
        return null;
    }
    const driver = value.driver;
    const daemon = value.daemon;
    const mcp = value.mcp;
    if (!driver ||
        !daemon ||
        !mcp ||
        Array.isArray(driver) ||
        Array.isArray(daemon) ||
        Array.isArray(mcp) ||
        !exactKeys(driver, ["path", "version", "source", "manifestSchema", "fileIdentity"]) ||
        !exactKeys(daemon, [
            "socketPath",
            "pid",
            "contractVersion",
            "toolsListSchemaVersion",
            "capabilityVersion",
            "mcpProtocolVersion",
        ]) ||
        !exactKeys(mcp, ["command", "args", "env"])) {
        return null;
    }
    if (typeof driver.path !== "string" ||
        !isAbsolute(driver.path) ||
        driver.version !== "0.19.3" ||
        !["bundled", "environment", "user-local", "path"].includes(String(driver.source)) ||
        driver.manifestSchema !== "1" ||
        !validDriverFileIdentity(driver.fileIdentity) ||
        typeof daemon.socketPath !== "string" ||
        !isAbsolute(daemon.socketPath) ||
        !Number.isInteger(daemon.pid) ||
        daemon.pid <= 0 ||
        daemon.contractVersion !== "0.6.0" ||
        daemon.toolsListSchemaVersion !== "1" ||
        daemon.capabilityVersion !== "1" ||
        daemon.mcpProtocolVersion !== "2025-06-18" ||
        mcp.command !== driver.path ||
        !Array.isArray(mcp.args) ||
        mcp.args.length !== 4 ||
        mcp.args[0] !== "mcp" ||
        mcp.args[1] !== "--embedded" ||
        mcp.args[2] !== "--socket" ||
        mcp.args[3] !== daemon.socketPath ||
        !mcp.env ||
        typeof mcp.env !== "object" ||
        Array.isArray(mcp.env) ||
        !exactKeys(mcp.env, [
            "CUA_DRIVER_EMBEDDED",
            "CUA_DRIVER_HOST_BUNDLE_ID",
            "CUA_DRIVER_RS_UPDATE_CHECK",
            "CUA_DRIVER_RS_TELEMETRY_ENABLED",
            ...(wayland ? ["CUA_DRIVER_RS_ENABLE_WAYLAND"] : []),
        ]) ||
        mcp.env.CUA_DRIVER_EMBEDDED !== "1" ||
        mcp.env.CUA_DRIVER_HOST_BUNDLE_ID !== "com.openmausbot.app" ||
        mcp.env.CUA_DRIVER_RS_UPDATE_CHECK !== "false" ||
        mcp.env.CUA_DRIVER_RS_TELEMETRY_ENABLED !== "false" ||
        (wayland && mcp.env.CUA_DRIVER_RS_ENABLE_WAYLAND !== "1")) {
        return null;
    }
    if (!Array.isArray(value.toolNames) ||
        value.toolNames.some((name) => typeof name !== "string") ||
        REQUIRED_LINUX_TOOLS.some((name) => !value.toolNames.includes(name)) ||
        !Array.isArray(value.doctorWarnings)) {
        return null;
    }
    for (const warning of value.doctorWarnings) {
        if (!warning ||
            typeof warning !== "object" ||
            Array.isArray(warning) ||
            ![3, 4].includes(Object.keys(warning).length) ||
            !Object.keys(warning).every((key) => ["label", "status", "message", "detail"].includes(key)) ||
            typeof warning.label !== "string" ||
            warning.status !== "warn" ||
            typeof warning.message !== "string" ||
            (warning.detail !== undefined && typeof warning.detail !== "string")) {
            return null;
        }
    }
    return {
        command: driver.path,
        args: [...mcp.args],
        env: { ...mcp.env },
        platform: "linux",
        generation: value.generation,
        scope: "local-computer",
    };
}
function processAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function ownedPrivate(stat, uid) {
    return (stat.uid === uid || stat.uid === 0) && (stat.mode & 0o077) === 0;
}
/** The driver a Linux descriptor names is the one published: same binary, a private socket, and both processes alive. */
export function validateLinuxRuntimeEndpoints(raw, { uid = process.getuid?.() ?? -1, isProcessAlive = processAlive, } = {}) {
    try {
        const driver = raw.driver;
        const daemon = raw.daemon;
        const binaryPath = driver.path;
        const socketPath = daemon.socketPath;
        const binaryStat = statSync(binaryPath);
        const currentFileIdentity = currentDriverFileIdentity(binaryPath);
        const socketStat = lstatSync(socketPath);
        const socketDirectoryStat = lstatSync(dirname(socketPath));
        return !(realpathSync(binaryPath) !== binaryPath ||
            !sameDriverFileIdentity(driver.fileIdentity, currentFileIdentity) ||
            !binaryStat.isFile() ||
            (binaryStat.uid !== uid && binaryStat.uid !== 0) ||
            (binaryStat.mode & 0o111) === 0 ||
            (binaryStat.mode & 0o022) !== 0 ||
            !socketStat.isSocket() ||
            socketStat.isSymbolicLink() ||
            !ownedPrivate(socketStat, uid) ||
            !socketDirectoryStat.isDirectory() ||
            socketDirectoryStat.isSymbolicLink() ||
            !ownedPrivate(socketDirectoryStat, uid) ||
            !isProcessAlive(raw.ownerPid) ||
            !isProcessAlive(daemon.pid));
    }
    catch {
        return false;
    }
}
/** The file form adds the descriptor's own privacy: a regular, non-symlink file and folder only this user can read. */
export function validateLinuxDescriptorRuntime(descriptorFile, raw, options = {}) {
    const uid = options.uid ?? process.getuid?.() ?? -1;
    try {
        const descriptorStat = lstatSync(descriptorFile);
        const descriptorDirectoryStat = lstatSync(dirname(descriptorFile));
        if (!descriptorStat.isFile() ||
            descriptorStat.isSymbolicLink() ||
            !ownedPrivate(descriptorStat, uid) ||
            !descriptorDirectoryStat.isDirectory() ||
            descriptorDirectoryStat.isSymbolicLink() ||
            !ownedPrivate(descriptorDirectoryStat, uid)) {
            return false;
        }
    }
    catch {
        return false;
    }
    return validateLinuxRuntimeEndpoints(raw, { ...options, uid });
}
/** Legacy descriptors name any command, so the file must be a regular non-symlink owned by this user and closed to
 * group/other writes. libuv reports every writable Windows file as uid 0 mode 0o666, so only the symlink rule applies there. */
function validateLegacyDescriptorRuntime(descriptorFile, platform, { uid = process.getuid?.() ?? -1 } = {}) {
    try {
        const stat = lstatSync(descriptorFile);
        if (!stat.isFile() || stat.isSymbolicLink())
            return false;
        if (platform !== "win32" && (stat.uid !== uid || (stat.mode & 0o022) !== 0))
            return false;
        return true;
    }
    catch {
        return false;
    }
}
/** The connection a driver record describes, or null: for Linux only while that driver is still the one published. */
export function decodeCuaConnection(raw, { platform = process.platform, validateLinuxRuntime = validateLinuxRuntimeEndpoints, } = {}) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return null;
    if (platform === "android")
        return decodeAndroidDescriptor(raw);
    if (platform === "linux") {
        const decoded = decodeLinuxDescriptor(raw);
        return decoded && validateLinuxRuntime(raw) ? decoded : null;
    }
    return decodeLegacyDescriptor(raw, platform);
}
/** Why the driver is not ready, from a macOS/Windows record that says so and says nothing else; never a connection. */
export function cuaUnavailableReason(raw, platform = process.platform) {
    if (!legacyPlatform(platform) || !raw || typeof raw !== "object" || Array.isArray(raw))
        return null;
    const record = raw;
    if (Object.keys(record).length !== 2 || record.mode !== "unavailable")
        return null;
    const reason = record.reason;
    return typeof reason === "string" && reason.trim() && reason.length <= 2_000 ? reason.trim() : null;
}
/** The desktop app's own record of its driver, read only by the packaging smoke check. No server mounts this computer from
 * it: the app hands its own server the connection instead (desktop-computer.ts), so the file grants nothing. */
export function readCuaConnection({ platform = process.platform, userData, validateLinuxRuntime = validateLinuxDescriptorRuntime, validateLegacyRuntime = validateLegacyDescriptorRuntime, }) {
    if (!userData)
        return null;
    const file = join(userData, "cua-connection.json");
    try {
        const raw = JSON.parse(readFileSync(file, "utf8"));
        if (platform === "linux")
            return decodeCuaConnection(raw, { platform, validateLinuxRuntime: (record) => validateLinuxRuntime(file, record) });
        if (platform === "android")
            return decodeCuaConnection(raw, { platform });
        return validateLegacyRuntime(file, platform) ? decodeCuaConnection(raw, { platform }) : null;
    }
    catch {
        return null;
    }
}
/** Reads the Android local computer connection from the app's userData directory. */
export function androidLocalComputerConnection(userData) {
    return readCuaConnection({ platform: "android", userData });
}
