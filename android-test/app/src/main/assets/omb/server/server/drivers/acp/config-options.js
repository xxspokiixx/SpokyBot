export function acpVariantOption(result) {
    const option = (Array.isArray(result?.configOptions) ? result.configOptions : []).find((entry) => entry?.type === "select" && typeof entry.id === "string"
        && (entry.id === "effort" || entry.category === "thought_level"));
    if (!option)
        return;
    const options = [];
    const seen = new Set();
    const collect = (entries) => {
        if (!Array.isArray(entries))
            return;
        for (const entry of entries) {
            if (typeof entry?.value === "string" && !seen.has(entry.value)) {
                seen.add(entry.value);
                options.push({ id: entry.value, label: typeof entry.name === "string" ? entry.name : entry.value });
            }
            else if (Array.isArray(entry?.options))
                collect(entry.options);
        }
    };
    collect(option.options);
    return {
        configId: option.id,
        options,
        ...(typeof option.currentValue === "string" ? { currentValue: option.currentValue } : {}),
    };
}
export function offeredModels(result, configId) {
    const option = (Array.isArray(result?.configOptions) ? result.configOptions : []).find((entry) => entry?.id === configId);
    const ids = [];
    const visit = (entries) => {
        if (!Array.isArray(entries))
            return;
        for (const entry of entries) {
            if (typeof entry?.value === "string")
                ids.push(entry.value);
            else if (Array.isArray(entry?.options))
                visit(entry.options);
        }
    };
    visit(option?.options);
    return ids;
}
