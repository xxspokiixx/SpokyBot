// A self-hosted server cannot replace itself, so this only says whether a newer release exists and how this install is updated.
import { existsSync } from "node:fs";
import { join, sep } from "node:path";
export const LATEST_RELEASE_URL = "https://api.github.com/repos/milind-soni/SpokyBot/releases/latest";
const CACHE_MS = 60 * 60_000;
/** As docs/self-hosting.md and deploy/podman/README.md give them. */
export const UPDATE_COMMANDS = {
    docker: { command: "docker compose pull omb && docker compose up -d", restart: false },
    podman: { command: "git pull && cd deploy/podman && PODMAN_COMPOSE_PROVIDER=podman-compose podman compose --env-file .env -f compose.yaml up -d --build", restart: false },
    npm: { command: "npm install -g openmausbot@latest", restart: true },
    git: { command: "git pull && pnpm install", restart: true },
};
export function installKind(input) {
    const exists = input.exists ?? existsSync;
    if (input.desktopManaged)
        return "desktop";
    if (input.managed)
        return "managed";
    if (exists("/.dockerenv"))
        return "docker";
    if (exists("/run/.containerenv"))
        return "podman";
    if (input.serverRoot.split(sep).includes("node_modules"))
        return "npm";
    if (exists(join(input.serverRoot, "..", ".git")))
        return "git";
    return "unknown";
}
/** Semver order on tags such as "v0.1.92"; a prerelease sorts before its release, and anything unparseable is never an update. */
export function isNewerVersion(latest, current) {
    const parse = (version) => {
        const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version.trim());
        return match ? { core: match.slice(1, 4).map(Number), pre: match[4]?.split(".") ?? [] } : null;
    };
    const a = parse(latest);
    const b = parse(current);
    if (!a || !b)
        return false;
    for (let i = 0; i < 3; i++) {
        if (a.core[i] !== b.core[i])
            return a.core[i] > b.core[i];
    }
    if (!a.pre.length || !b.pre.length)
        return !a.pre.length && b.pre.length > 0;
    for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
        const x = a.pre[i];
        const y = b.pre[i];
        if (x === undefined || y === undefined)
            return y === undefined;
        if (x === y)
            continue;
        const xn = /^\d+$/.test(x);
        const yn = /^\d+$/.test(y);
        if (xn && yn)
            return Number(x) > Number(y);
        if (xn !== yn)
            return yn;
        return x > y;
    }
    return false;
}
/** One cached GitHub lookup an hour, shared by every caller. */
export function createUpdateChecker(options) {
    const fetchRelease = options.fetch ?? fetch;
    const now = options.now ?? Date.now;
    let cached;
    let inflight;
    const base = () => ({
        current: options.current,
        install: options.install,
        available: false,
        ...UPDATE_COMMANDS[options.install],
    });
    return async function check() {
        if (options.install === "desktop" || options.install === "managed")
            return base();
        if (cached && now() - cached.at < CACHE_MS)
            return cached.result;
        inflight ??= (async () => {
            try {
                const response = await fetchRelease(LATEST_RELEASE_URL, {
                    headers: { accept: "application/vnd.github+json", "user-agent": "openmausbot-update-check" },
                    signal: AbortSignal.timeout(8_000),
                });
                if (!response.ok)
                    throw new Error(`GitHub answered ${response.status}`);
                const release = await response.json();
                if (typeof release.tag_name !== "string")
                    throw new Error("GitHub sent no release tag");
                const latest = release.tag_name.replace(/^v/, "");
                const result = {
                    ...base(),
                    latest,
                    available: isNewerVersion(latest, options.current),
                    ...(typeof release.html_url === "string" ? { releaseUrl: release.html_url } : {}),
                };
                cached = { at: now(), result };
                return result;
            }
            finally {
                inflight = undefined;
            }
        })();
        return inflight;
    };
}
