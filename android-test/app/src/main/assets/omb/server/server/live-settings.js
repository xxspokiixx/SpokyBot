export const LIVE_IDLE_MINUTES_DEFAULT = 5;
export function liveCallKey(cfg) {
    const live = cfg.live?.key?.trim();
    if (live)
        return { key: live, source: "live" };
    const openai = cfg.openai?.key?.trim();
    return openai ? { key: openai, source: "openai" } : null;
}
export function liveSettingsFor(cfg) {
    const minutes = cfg.live?.idleMinutes;
    const key = liveCallKey(cfg);
    return {
        configured: key !== null,
        ...(key ? { keySource: key.source } : {}),
        voice: cfg.live?.voice ?? "",
        readTypedReplies: cfg.live?.readTypedReplies ?? true,
        idleMinutes: Number.isInteger(minutes) && minutes >= 1 && minutes <= 60 ? minutes : LIVE_IDLE_MINUTES_DEFAULT,
    };
}
