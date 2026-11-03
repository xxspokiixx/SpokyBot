const plainRecord = (value) => value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
/** A guest-driven turn's app-server: shell, unified exec and image reads (codex-cli 0.159.0
 * `features`) off, web search too. */
export const GUEST_CONFINED_CODEX_ARGS = [
    "-c", "features.shell_tool=false", "-c", "features.unified_exec=false", "-c", "features.view_image=false", "-c", 'web_search="disabled"',
];
export function codexShellDisabled(config) {
    const features = plainRecord(plainRecord(config)?.features);
    return features?.shell_tool === false && features?.unified_exec === false && features?.view_image === false;
}
