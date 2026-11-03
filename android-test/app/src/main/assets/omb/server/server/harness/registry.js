// Provider instance registry — port of upstream's ProviderInstanceRegistryLive behavior, minus Effect.
import { findCliCandidates } from "../env-path.js";
import { installNpmEngine, npmAvailable, serverInstallFor } from "../engine-install.js";
import { withEngineMemory } from "../engine-memory.js";
export { engineMemory } from "../engine-memory.js";
function withServerInstall(install, npmPresent) {
    if (!install)
        return undefined;
    const server = serverInstallFor(install, npmPresent);
    const platform = process.platform === "darwin" || process.platform === "linux" || process.platform === "win32" ? process.platform : undefined;
    return { ...install, platform, ...(server ? { server } : {}) };
}
function cliDefaultOf(driver) {
    if (!driver)
        return undefined;
    try {
        const cfg = driver.defaultConfig();
        return typeof cfg?.cli === "string" ? cfg.cli : undefined;
    }
    catch {
        return undefined;
    }
}
function cliOfRaw(raw) {
    const cli = raw?.cli;
    return typeof cli === "string" && cli ? cli : undefined;
}
export const SNAPSHOT_DEADLINE_MS = 60_000;
/** How long a finished status read answers later reads, so a start-up's model lists and engine-list reads probe each CLI once. */
export const SNAPSHOT_REUSE_MS = 3_000;
const SNAPSHOT_DEADLINE_REASON = "This engine did not report its status within a minute. Check that its CLI starts in a terminal.";
function withinDeadline(read) {
    let deadline;
    return Promise.race([
        read(),
        new Promise((_resolve, reject) => {
            deadline = setTimeout(() => reject(new Error(SNAPSHOT_DEADLINE_REASON)), SNAPSHOT_DEADLINE_MS);
            deadline.unref?.();
        }),
    ]).finally(() => clearTimeout(deadline));
}
export class ProviderRegistry {
    byId = new Map();
    cliByInstance = new Map();
    lastSnapshots = new Map();
    snapshotGeneration = 0;
    driversByKind;
    enginesBaseDir;
    npmPresent;
    constructor(drivers, options = {}) {
        this.enginesBaseDir = options.enginesBaseDir;
        this.npmPresent = options.npmAvailable ?? npmAvailable;
        this.driversByKind = new Map(drivers.map((d) => [d.driverKind, d]));
    }
    async load(configs, decorate) {
        const slots = [...this.byId.keys()];
        const loaded = await Promise.all(Object.entries(configs).map(async ([instanceId, entry]) => {
            const ready = await this.createEntry(instanceId, entry, decorate);
            this.byId.set(instanceId, ready);
            return ready;
        }));
        // Config order, not completion order; an entry a dispose replaced meanwhile is not this load's to place.
        const placed = new Set(loaded.filter((entry) => this.byId.get(entry.instanceId) === entry).map((entry) => entry.instanceId));
        const entries = new Map(this.byId);
        this.byId.clear();
        for (const id of [...slots, ...[...entries.keys()].filter((id) => !placed.has(id)), ...placed]) {
            const entry = entries.get(id);
            if (entry && !this.byId.has(id))
                this.byId.set(id, entry);
        }
    }
    async createEntry(instanceId, entry, decorate) {
        await this.dispose(instanceId);
        const driver = this.driversByKind.get(entry.driver);
        if (!driver) {
            return {
                instanceId,
                shadow: {
                    instanceId,
                    driverKind: entry.driver,
                    displayName: entry.displayName,
                    cli: cliOfRaw(entry.config),
                    shadow: true,
                    reason: `unknown driver "${entry.driver}" — kept as configured, unavailable here`,
                },
            };
        }
        try {
            const config = entry.config === undefined ? driver.defaultConfig() : driver.decodeConfig(entry.config);
            // The RAW config: decodeConfig fills in the driver default, which would flag every instance as overridden.
            const rawCli = cliOfRaw(entry.config);
            if (rawCli)
                this.cliByInstance.set(instanceId, rawCli);
            const live = withEngineMemory(await driver.create({
                instanceId,
                displayName: entry.displayName ?? driver.metadata.displayName,
                environment: entry.environment ?? {},
                enabled: entry.enabled ?? true,
                config,
            }));
            this.shareSnapshot(live);
            return { instanceId, live: decorate ? decorate(live) : live };
        }
        catch (e) {
            return {
                instanceId,
                shadow: {
                    instanceId,
                    driverKind: entry.driver,
                    displayName: entry.displayName ?? driver.metadata.displayName,
                    cli: cliOfRaw(entry.config),
                    shadow: true,
                    reason: e instanceof Error ? e.message : String(e),
                },
            };
        }
    }
    /**
     * One engine's status read, bounded and shared: callers join the probe in flight, and one that finished within
     * SNAPSHOT_REUSE_MS answers again, so the CLI is not spawned twice for the same answer. A failed read is never reused.
     * Replaced on the driver's own instance, beneath a decorator's checks, which still run on every read; an object
     * spread would evaluate getters such as `models` once.
     */
    shareSnapshot(instance) {
        const read = instance.snapshot.bind(instance);
        let held;
        instance.snapshot = () => {
            if (held && held.generation === this.snapshotGeneration
                && (held.settledAt === undefined || Date.now() - held.settledAt < SNAPSHOT_REUSE_MS))
                return held.read;
            const current = { generation: this.snapshotGeneration, read: withinDeadline(read) };
            held = current;
            current.read.then(() => { current.settledAt = Date.now(); }, () => { if (held === current)
                held = undefined; });
            return current.read;
        };
    }
    /** Every engine's next status read probes its CLI again: an install, update, sign-in or key change may alter what it reports. */
    forgetSnapshots() {
        this.snapshotGeneration += 1;
    }
    get(instanceId) {
        return this.byId.get(instanceId)?.live ?? null;
    }
    lastSnapshot(instanceId) {
        return this.byId.get(instanceId)?.live ? this.lastSnapshots.get(instanceId) : undefined;
    }
    access(instanceId) {
        const entry = this.byId.get(instanceId);
        return entry ? this.driversByKind.get(entry.shadow?.driverKind ?? entry.live.driverKind)?.metadata.access ?? "subscription" : undefined;
    }
    /** From the registry's config, never an HTTP body. */
    cliTarget(instanceId) {
        const entry = this.byId.get(instanceId);
        if (!entry)
            return null;
        const driverKind = entry.shadow?.driverKind ?? entry.live.driverKind;
        const driver = this.driversByKind.get(driverKind);
        return {
            driverKind,
            cli: this.cliByInstance.get(instanceId) ?? entry.shadow?.cli ?? cliDefaultOf(driver) ?? null,
        };
    }
    entries() {
        return [...this.byId.values()];
    }
    instances() {
        return [...this.byId.values()].flatMap((e) => (e.live ? [e.live] : []));
    }
    /** Settings' Check and Refresh, and OpenCode's key policy changing: the engine's status is read again too. */
    async refreshModels(instanceId) {
        const instance = this.get(instanceId);
        if (!instance)
            return false;
        try {
            await instance.refreshModels?.();
        }
        finally {
            this.forgetSnapshots();
        }
        return true;
    }
    async installRuntime(instanceId) {
        const entry = this.byId.get(instanceId);
        if (!entry)
            return false;
        // A failed install changes the status too: Antigravity reports the failure as its reason.
        try {
            if (entry.live?.installRuntime) {
                await entry.live.installRuntime();
                return true;
            }
            const driver = this.driversByKind.get(entry.shadow?.driverKind ?? entry.live.driverKind);
            const server = serverInstallFor(driver?.install, this.npmPresent());
            if (!server)
                return false;
            await installNpmEngine(server.package, { baseDir: this.enginesBaseDir, cli: cliDefaultOf(driver) });
            return true;
        }
        finally {
            this.forgetSnapshots();
        }
    }
    async startAuthentication(instanceId) {
        const instance = this.get(instanceId);
        return instance?.startAuthentication ? instance.startAuthentication() : null;
    }
    async getAuthentication(instanceId, flowId) {
        const instance = this.get(instanceId);
        return instance?.getAuthentication ? instance.getAuthentication(flowId) : null;
    }
    async completeAuthentication(instanceId, flowId, callbackUrl) {
        const instance = this.get(instanceId);
        if (!instance?.completeAuthentication)
            return false;
        await instance.completeAuthentication(flowId, callbackUrl);
        return true;
    }
    async cancelAuthentication(instanceId) {
        const instance = this.get(instanceId);
        if (!instance?.cancelAuthentication)
            return false;
        await instance.cancelAuthentication();
        return true;
    }
    async describe() {
        const candidatesByName = new Map();
        const candidatesFor = (driver) => {
            const name = cliDefaultOf(driver);
            if (!name)
                return [];
            const cached = candidatesByName.get(name);
            if (cached)
                return cached;
            const found = findCliCandidates(name);
            candidatesByName.set(name, found);
            return found;
        };
        const npmPresent = this.npmPresent();
        return Promise.all(this.entries().map(async (entry) => {
            const driver = this.driversByKind.get(entry.shadow?.driverKind ?? entry.live.driverKind);
            if (entry.shadow) {
                return {
                    instanceId: entry.instanceId,
                    driverKind: entry.shadow.driverKind,
                    displayName: entry.shadow.displayName ?? entry.shadow.driverKind,
                    snapshot: { state: "unavailable", reason: entry.shadow.reason },
                    models: { default: "", options: [] },
                    capabilities: { computerMcp: false, agentsMcp: false, localComputerMcp: false },
                    access: driver?.metadata.access ?? "subscription",
                    install: withServerInstall(driver?.install, npmPresent),
                    cli: entry.shadow.cli,
                    cliDefault: cliDefaultOf(driver),
                    cliCandidates: candidatesFor(driver),
                };
            }
            const inst = entry.live;
            let snapshot;
            try {
                snapshot = await inst.snapshot();
            }
            catch (e) {
                snapshot = { state: "unavailable", reason: e instanceof Error ? e.message : String(e) };
            }
            // Only while this is still the live instance: a reload may have replaced it during the read.
            if (this.byId.get(inst.instanceId)?.live === inst)
                this.lastSnapshots.set(inst.instanceId, snapshot);
            return {
                instanceId: inst.instanceId,
                driverKind: inst.driverKind,
                displayName: inst.displayName ?? inst.driverKind,
                snapshot,
                models: inst.models,
                capabilities: {
                    computerMcp: inst.adapter.capabilities.computerMcp === true,
                    agentsMcp: inst.adapter.capabilities.agentsMcp === true,
                    composioMcp: inst.adapter.capabilities.composioMcp === true,
                    phoneMcp: inst.adapter.capabilities.phoneMcp === true,
                    browserMcp: inst.adapter.capabilities.browserMcp === true,
                    images: inst.adapter.capabilities.images === true,
                    effortLevels: inst.adapter.capabilities.effortLevels,
                    modelVariants: inst.adapter.capabilities.modelVariants === true,
                    queueing: inst.adapter.capabilities.queueing === true,
                    localComputerMcp: inst.adapter.capabilities.localComputerMcp === true,
                    approvalReview: inst.reviewPermission !== undefined,
                    backgroundText: inst.generateText !== undefined || inst.generateMemoryText !== undefined,
                },
                access: driver?.metadata.access ?? "subscription",
                install: withServerInstall(driver?.install, npmPresent),
                authentication: inst.startAuthentication
                    ? {
                        method: inst.authenticationMethod ?? (inst.getAuthentication && inst.completeAuthentication
                            ? "paste-code" // a link to open, then a code pasted back (Claude)
                            : inst.getAuthentication
                                ? "device-code" // a code to enter at the provider's page (Codex)
                                : "browser"), // a link and a callback URL (managed engines)
                        signOut: inst.signOut !== undefined,
                    }
                    : undefined,
                cli: this.cliByInstance.get(inst.instanceId),
                cliDefault: cliDefaultOf(driver),
                cliCandidates: candidatesFor(driver),
            };
        }));
    }
    async disposeAll() {
        await Promise.allSettled(this.instances().map((i) => i.dispose()));
        this.byId.clear();
        this.cliByInstance.clear();
        this.lastSnapshots.clear();
    }
    async dispose(instanceId) {
        const entry = this.byId.get(instanceId);
        this.byId.delete(instanceId);
        this.cliByInstance.delete(instanceId);
        this.lastSnapshots.delete(instanceId);
        await entry?.live?.dispose();
    }
}
