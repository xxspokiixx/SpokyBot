// Reading an engine CLI's `--version` probe and comparing dotted versions.
/** Hermes writes its whole `--version` banner to stderr with an empty stdout. */
export function versionFromProbe(stdout, stderr) {
    const out = (stdout ?? "").trim();
    if (out)
        return out;
    const err = (stderr ?? "").trim().split(/\r\n|\n|\r/, 1)[0]?.trim() ?? "";
    return err || null;
}
export function parseVersionTriple(value) {
    const match = /(\d+)\.(\d+)\.(\d+)/.exec(value);
    if (!match)
        return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}
export function versionAtLeast(installed, floor) {
    for (let i = 0; i < 3; i += 1) {
        if (installed[i] !== floor[i])
            return installed[i] > floor[i];
    }
    return true;
}
