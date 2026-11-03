// Plugins & skills catalog domain model (spec: docs? Development prompt).
// Shared by server, UI, and assistant tool layer. Ids are stable strings.
export function searchPlugins(plugins, query, installedIds) {
    const q = (query ?? "").trim().toLowerCase();
    const scored = plugins.map((p) => {
        const haystack = `${p.name} ${p.description} ${p.category}`.toLowerCase();
        let score = 0;
        if (!q)
            score = 1;
        else if (haystack.includes(q))
            score = 10 + (p.name.toLowerCase().includes(q) ? 5 : 0);
        else {
            // token overlap
            const tokens = q.split(/\s+/);
            for (const t of tokens)
                if (haystack.includes(t))
                    score += 2;
        }
        return { p, score };
    });
    return scored
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
        .slice(0, 10)
        .map(({ p }) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        installed: installedIds?.has(p.id) ?? false,
        connectorCount: p.connectors.length,
        skillCount: p.skills.length,
        category: p.category,
    }));
}
