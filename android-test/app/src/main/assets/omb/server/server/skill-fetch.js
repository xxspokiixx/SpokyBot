import { z } from "zod";
const MAX_FILES = 30;
const MAX_FILE_BYTES = 256 * 1024;
const API = "https://api.github.com";
class ImportLimitError extends Error {
}
// One budget for the whole import, enforced while reading the stream.
function boundedImportFetch(fetcher) {
    let requests = 0;
    let bytes = 0;
    const signal = AbortSignal.timeout(60_000);
    return async (input, init) => {
        if (++requests > 128)
            throw new ImportLimitError("Import request limit reached — paste a specific skill folder instead.");
        signal.throwIfAborted();
        const response = await fetcher(input, { ...init, signal });
        if (!response.ok) {
            await response.body?.cancel().catch(() => { });
            return response;
        }
        if (!response.body)
            return response;
        const listing = String(input).startsWith(`${API}/`);
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        try {
            while (true) {
                const chunk = await reader.read();
                if (chunk.done)
                    break;
                size += chunk.value.byteLength;
                bytes += chunk.value.byteLength;
                if (size > (listing ? 1_048_576 : MAX_FILE_BYTES) || bytes > 8 * 1_048_576) {
                    throw new ImportLimitError("Import size limit reached — paste a smaller skill folder instead.");
                }
                chunks.push(chunk.value);
            }
        }
        finally {
            await reader.cancel().catch(() => { });
        }
        return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
    };
}
export function parseSkillSource(input) {
    const text = input.trim();
    if (!text)
        return { error: "paste a GitHub repository, folder, or SKILL.md URL" };
    const raw = text.match(/^(https?):\/\/raw\.githubusercontent\.com\/.+\/SKILL\.md$/i);
    if (raw) {
        // Plain http sends the skill URL in the clear; refuse it rather than upgrade it.
        return raw[1].toLowerCase() === "https"
            ? { rawUrl: text }
            : { error: "paste an https:// raw.githubusercontent.com link instead of plain http" };
    }
    const blob = text.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/((?:.*\/)?SKILL\.md)$/i);
    if (blob) {
        return { rawUrl: `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}/${blob[4]}` };
    }
    const tree = text.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.*))?)?\/?$/i);
    if (tree) {
        return { owner: tree[1], repo: tree[2], ref: tree[3], path: tree[4] ?? "" };
    }
    const registry = text.match(/^https?:\/\/skills\.sh\/([\w.-]+)\/([\w.-]+)(?:\/([\w.-]+))?\/?$/i);
    if (registry) {
        if ([registry[1], registry[2]].some((part) => part === "." || part === "..") ||
            (registry[3] && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(registry[3]))) {
            return { error: "that does not look like a skills.sh repository or skill URL" };
        }
        // skills.sh pages install from github.com/<owner>/<repo>, filtered to the named skill.
        return { owner: registry[1], repo: registry[2], path: "", skill: registry[3] };
    }
    const shorthand = text.match(/^([\w.-]+)\/([\w.-]+)$/);
    if (shorthand)
        return { owner: shorthand[1], repo: shorthand[2], path: "" };
    return { error: "that does not look like a GitHub or skills.sh repository, folder, or SKILL.md URL" };
}
const CONTENT_ENTRY = z.object({
    type: z.string(),
    name: z.string(),
    path: z.string(),
    download_url: z.string().nullable().optional(),
});
const CONTENT_LISTING = z.array(z.unknown()).catch([]);
function asEntries(listing) {
    return listing.flatMap((item) => {
        const entry = CONTENT_ENTRY.safeParse(item);
        return entry.success ? [entry.data] : [];
    });
}
async function fetchListing(url, fetcher) {
    const response = await fetcher(url, {
        headers: { accept: "application/vnd.github+json", "user-agent": "SpokyBot-skills" },
    });
    if (!response.ok)
        throw new Error(`GitHub API ${response.status} for ${url}`);
    return asEntries(CONTENT_LISTING.parse(await response.json()));
}
// Pin download_urls and pasted raw URLs to https on the raw host, no port or credentials, so a tampered response cannot aim server fetches elsewhere.
function assertPinnedRawUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        throw new Error(`refusing to download ${url} — not a valid URL`);
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.hostname !== "raw.githubusercontent.com") {
        throw new Error(`refusing to download ${url} — skill files must be https://raw.githubusercontent.com links`);
    }
}
async function fetchText(url, fetcher) {
    assertPinnedRawUrl(url);
    // The raw host never redirects: error rather than follow one to an arbitrary host.
    const response = await fetcher(url, { headers: { "user-agent": "SpokyBot-skills" }, redirect: "error" });
    if (!response.ok)
        throw new Error(`download failed (${response.status})`);
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_FILE_BYTES)
        throw new Error("file is larger than the 256KB import cap");
    return text;
}
async function listDir(target, path, fetcher) {
    const ref = target.ref ? `?ref=${encodeURIComponent(target.ref)}` : "";
    const url = `${API}/repos/${target.owner}/${target.repo}/contents/${path}${ref}`;
    return fetchListing(url, fetcher);
}
export const MAX_SKILLS_PER_IMPORT = 30;
const MAX_FOLDERS_WALKED = 24;
const MAX_CHILDREN_PER_FOLDER = 60;
/** Mirrors skills.sh's toSkillSlug: page slugs come from SKILL.md names, which can differ from folder names. */
const toSkillSlug = (name) => name.toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
async function skillNameFrom(entries, fetcher) {
    const skillMd = entries.find((entry) => entry.type === "file" && entry.name === "SKILL.md" && entry.download_url);
    if (!skillMd)
        return undefined;
    try {
        const text = await fetchText(skillMd.download_url, fetcher);
        return text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]?.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    }
    catch (error) {
        if (error instanceof ImportLimitError || (error instanceof Error && error.name === "TimeoutError"))
            throw error;
        return undefined;
    }
}
/** The skills.sh registry's discovery order: the path, skills/, .claude/skills/, .agents/skills/, then direct children. */
export async function discoverSkillDirs(target, fetcher) {
    const root = await listDir(target, target.path, fetcher);
    const wanted = target.skill ? toSkillSlug(target.skill) || undefined : undefined;
    const dirMatches = (dir) => !!wanted && toSkillSlug(dir.split("/").at(-1)) === wanted;
    const isWanted = async (dir, entries) => {
        if (!wanted)
            return true;
        if (dirMatches(dir))
            return true;
        const name = await skillNameFrom(entries, fetcher);
        return !!name && toSkillSlug(name) === wanted;
    };
    if (root.some((entry) => entry.type === "file" && entry.name === "SKILL.md") && (await isWanted(target.path, root))) {
        return [target.path];
    }
    const dirs = root.filter((entry) => entry.type === "dir");
    const found = [];
    const preferred = ["skills", ".claude", ".agents"];
    const rank = (name) => (wanted && toSkillSlug(name) === wanted ? 0 : preferred.includes(name) ? 1 : 2);
    const ordered = [...dirs].sort((a, b) => rank(a.name) - rank(b.name));
    const enough = () => found.length >= (wanted ? 1 : MAX_SKILLS_PER_IMPORT);
    for (const dir of ordered.slice(0, MAX_FOLDERS_WALKED)) {
        if (enough())
            break;
        const base = dir.name === ".claude" || dir.name === ".agents" ? `${dir.path}/skills` : dir.path;
        let children;
        try {
            children = await listDir(target, base, fetcher);
        }
        catch (error) {
            if (error instanceof ImportLimitError || (error instanceof Error && error.name === "TimeoutError"))
                throw error;
            continue;
        }
        if (children.some((entry) => entry.type === "file" && entry.name === "SKILL.md")) {
            if (await isWanted(base, children))
                found.push(base);
            continue;
        }
        const childDirs = children.filter((entry) => entry.type === "dir");
        const exact = wanted ? childDirs.find((child) => dirMatches(child.path)) : undefined;
        const candidates = exact
            ? [exact, ...childDirs.filter((child) => child !== exact).slice(0, MAX_CHILDREN_PER_FOLDER - 1)]
            : childDirs.slice(0, MAX_CHILDREN_PER_FOLDER);
        for (const child of candidates) {
            if (enough())
                break;
            try {
                const inner = await listDir(target, child.path, fetcher);
                if (inner.some((entry) => entry.type === "file" && entry.name === "SKILL.md") && (await isWanted(child.path, inner)))
                    found.push(child.path);
            }
            catch (error) {
                if (error instanceof ImportLimitError || (error instanceof Error && error.name === "TimeoutError"))
                    throw error;
            }
        }
    }
    return found;
}
/** Entries that are not downloaded come back path-only (empty content) so the install lists them as skipped. */
export async function fetchSkillDir(target, dir, fetcher) {
    const entries = await listDir(target, dir, fetcher);
    const markdown = entries.filter((entry) => entry.type === "file" && /\.md$/i.test(entry.name) && entry.download_url);
    if (!markdown.some((entry) => entry.name === "SKILL.md")) {
        throw new Error(`no SKILL.md in ${dir || "the repository root"}`);
    }
    const downloadable = [
        markdown.find((entry) => entry.name === "SKILL.md"),
        ...markdown.filter((entry) => entry.name !== "SKILL.md").slice(0, MAX_FILES - 1),
    ];
    const files = [];
    for (let i = 0; i < downloadable.length; i += 4) {
        files.push(...await Promise.all(downloadable.slice(i, i + 4).map(async (entry) => ({
            path: entry.name,
            content: await fetchText(entry.download_url, fetcher),
        }))));
    }
    for (const entry of entries) {
        if (downloadable.includes(entry))
            continue;
        files.push({ path: entry.type === "dir" ? `${entry.name}/` : entry.name, content: "" });
    }
    const ref = target.ref ? `@${target.ref}` : "";
    return { source: `github.com/${target.owner}/${target.repo}${ref}/${dir}`.replace(/\/$/, ""), files };
}
export async function fetchSkillFromSource(input, fetcher = fetch) {
    const parsed = parseSkillSource(input);
    if ("error" in parsed)
        return parsed;
    fetcher = boundedImportFetch(fetcher);
    try {
        if ("rawUrl" in parsed) {
            const content = await fetchText(parsed.rawUrl, fetcher);
            return { skills: [{ source: parsed.rawUrl, files: [{ path: "SKILL.md", content }] }] };
        }
        const dirs = await discoverSkillDirs(parsed, fetcher);
        if (!dirs.length) {
            return {
                error: parsed.skill
                    ? `no skill named "${parsed.skill}" found there — check the exact name on the skills.sh page`
                    : "no SKILL.md found there — paste a skill folder or a repo with a skills/ directory",
            };
        }
        const skills = [];
        for (const dir of dirs)
            skills.push(await fetchSkillDir(parsed, dir, fetcher));
        return { skills };
    }
    catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
}
