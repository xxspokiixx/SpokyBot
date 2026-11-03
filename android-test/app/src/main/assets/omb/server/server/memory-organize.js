import { alwaysCore, factIdentity, isExpired, parseMemoryEntries } from "./memory-entries.js";
import { topicFileName } from "./memory-capture.js";
export const ORGANIZE_MARKER = "You are the ORGANIZE step of a memory system";
export const MAX_MOVES = 20;
const PROMPT_ENTRIES = 60;
export function organizeCandidates(text, today, core) {
    return parseMemoryEntries(text)
        .filter((e) => !e.struck && !isExpired(e, today) && !core.has(factIdentity(e.body)) && !alwaysCore(e.body))
        .slice(0, PROMPT_ENTRIES);
}
export function organizePrompt(candidates, topics) {
    return [
        `${ORGANIZE_MARKER}. You have no tools. Read only what is below.`,
        "",
        "An assistant's core notebook, loaded into every conversation, holds these numbered lines:",
        candidates.map((e, index) => `[${index}] ${e.body}`).join("\n") || "(nothing)",
        "",
        `Topic files it already keeps:\n${topics.trim() || "(none yet)"}`,
        "",
        "Core, never moved: facts about the person themselves that matter in any conversation — their name, where they live now, their company and role, their diet, allergies and health needs, how they like to be spoken to, and standing decisions.",
        "Move a line only when it is detail about a particular subject: another person (\"asha\"), a project or client, a trip or a place, likes and dislikes in one domain (\"food\"). Reuse an existing topic name when one fits; otherwise name a new one in one or two words.",
        "When in doubt, keep the line in the notebook.",
        "For each line to move, give its number, the topic, and aliases: two to five other words someone might use when asking about that subject.",
        "Answer with one JSON object and nothing else:",
        '{"moves": [{"i": <number>, "topic": "name", "aliases": ["..."]}]}',
        'When every line is core, answer {"moves": []}.',
    ].join("\n");
}
export function parseMoves(text, candidates) {
    const trimmed = text.trim();
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
    const body = (fenced ? fenced[1] : trimmed).trim();
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start < 0 || end <= start)
        return null;
    let parsed;
    try {
        parsed = JSON.parse(body.slice(start, end + 1));
    }
    catch {
        return null;
    }
    if (!parsed || !Array.isArray(parsed.moves))
        return null;
    const out = [];
    const seen = new Set();
    for (const move of parsed.moves) {
        if (!move || typeof move !== "object")
            return null;
        const { i, topic, aliases } = move;
        if (!Number.isInteger(i) || i < 0 || i >= candidates.length)
            return null;
        if (seen.has(i))
            continue;
        const name = topicFileName(topic);
        if (!name)
            return null;
        seen.add(i);
        out.push({
            entry: candidates[i],
            topic: name,
            aliases: Array.isArray(aliases)
                ? aliases.filter((a) => typeof a === "string").map((a) => a.replace(/[\r\n,[\]]+/g, " ").trim().slice(0, 40)).filter(Boolean).slice(0, 8)
                : [],
        });
    }
    return out;
}
export function applyMoves(text, moves) {
    const drop = new Set(moves.map((move) => move.entry.line));
    const byTopic = new Map();
    for (const move of moves) {
        const group = byTopic.get(move.topic) ?? { lines: [], aliases: [] };
        group.lines.push(move.entry.raw);
        for (const alias of move.aliases)
            if (!group.aliases.includes(alias))
                group.aliases.push(alias);
        byTopic.set(move.topic, group);
    }
    return { text: text.split("\n").filter((_, index) => !drop.has(index)).join("\n"), byTopic };
}
