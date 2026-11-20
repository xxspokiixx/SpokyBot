import { createHash } from "node:crypto";
import { lstatSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DESCRIPTION_MAX, isSkillName, readSkillFrontmatter, SKILL_FILE_MAX_BYTES } from "../shared/skill-md.js";
import { nativeSkillFolders, readFileNoFollow } from "./imported-skills.js";
import { entryExistsWithoutFollowing } from "./skill-storage.js";
/** Claude Code (2.1.304) loads `.claude/skills` from a turn's folder and each folder above it, up to the nearest git
 * root, and never the home folder's, which holds the person's own skills. */
function projectSkillFolders(cwd, home) {
    const folders = [];
    for (let at = resolve(cwd); at !== resolve(home); at = dirname(at)) {
        folders.push(join(at, ".claude", "skills"));
        if (entryExistsWithoutFollowing(join(at, ".git")) || dirname(at) === at)
            break;
    }
    return folders;
}
/** A skill folder may be a link, as the engine follows it; SKILL.md itself must be a plain file of a skill's size. As in
 * Claude Code (2.1.304), the folder names the command, frontmatter is optional, and `user-invocable: false` keeps a
 * skill out of `/`. */
function readNativeSkill(root, name) {
    const folder = join(root, name);
    const file = join(folder, "SKILL.md");
    try {
        const info = lstatSync(file);
        if (!info.isFile() || info.size > SKILL_FILE_MAX_BYTES)
            return null;
    }
    catch {
        return null;
    }
    const text = readFileNoFollow(file)?.toString("utf8");
    if (!text)
        return null;
    const frontmatter = readSkillFrontmatter(text);
    if (/^(?:false|no|off|0)$/i.test(frontmatter?.fields["user-invocable"] ?? ""))
        return null;
    const firstParagraph = (frontmatter?.body ?? text).trim().split(/\r?\n\s*\r?\n/)[0].replace(/\s+/g, " ");
    const description = (frontmatter?.fields.description || firstParagraph).slice(0, DESCRIPTION_MAX);
    return { name, description, folder, file, source: root, sha256: createHash("sha256").update(text).digest("hex") };
}
/** The skills an engine loads by itself for turns in `cwd` (null: no folder of its own), read only. The person's own
 * folder wins a name, as in Claude Code, then the nearer project folder. */
export function nativeSkills(engine, options) {
    const project = engine.driverKind === "claudeAgent" && options.cwd ? projectSkillFolders(options.cwd, options.home ?? homedir()) : [];
    const seen = new Set();
    return [...nativeSkillFolders(engine, options), ...project].flatMap((root) => {
        let names;
        try {
            names = readdirSync(root).filter(isSkillName).sort();
        }
        catch {
            return [];
        }
        return names.flatMap((name) => {
            if (seen.has(name))
                return [];
            const skill = readNativeSkill(root, name);
            if (!skill)
                return [];
            seen.add(name);
            return [skill];
        });
    });
}
/** Bot Settings → Skills and the `/` menu: always on, and changed only where it lives. */
export function nativeSkillListing(skill) {
    return {
        name: skill.name,
        description: skill.description,
        enabled: true,
        editable: false,
        source: skill.source,
        sha256: skill.sha256,
        importedAt: "",
        warnings: [],
        skippedFiles: [],
        origin: "native",
    };
}
export function readNativeSkillFile(skill) {
    return readFileNoFollow(skill.file)?.toString("utf8") ?? null;
}
