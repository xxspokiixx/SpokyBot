/**
 * Credentials an agent may ask the person to provide through an inline
 * card. The id is the entire authority surface: agents never choose a
 * config path, label, URL, or arbitrary field name.
 */
export const CREDENTIAL_TARGETS = {
    xaiApiKey: {
        label: "xAI API key",
        description: "Used by the built-in Grok provider.",
        placeholder: "xai-…",
        helpUrl: "https://console.x.ai/",
    },
    boxToken: {
        label: "Boat API key",
        description: "Gives bots an isolated cloud computer when Boat is selected.",
        placeholder: "Paste your Boat API key",
        helpUrl: "https://docs.boat.dev/api-keys",
    },
    opencodeGoApiKey: {
        label: "OpenCode API key",
        description: "Used for OpenCode Zen and Go.",
        placeholder: "Paste your OpenCode API key",
        helpUrl: "https://opencode.ai/docs/providers/",
    },
    ttsKey: {
        label: "ElevenLabs API key",
        description: "Enables text-to-speech voices in calls.",
        placeholder: "Paste your ElevenLabs API key",
        helpUrl: "https://elevenlabs.io/app/settings/api-keys",
    },
    fishAudioKey: {
        label: "Fish Audio API key",
        description: "Enables Fish Audio voices in calls.",
        placeholder: "Paste your Fish Audio API key",
        helpUrl: "https://fish.audio/app/api-keys/",
    },
    openaiImageApiKey: {
        label: "OpenAI API key",
        description: "Used only to generate custom bot avatar images.",
        placeholder: "sk-…",
        helpUrl: "https://platform.openai.com/api-keys",
    },
    onePasswordToken: {
        label: "1Password service account token",
        description: "Lets bots sign in with the website logins in the 1Password vault this token can read, the way Settings → Logins does.",
        placeholder: "ops_…",
        helpUrl: "https://developer.1password.com/docs/service-accounts/get-started/",
    },
};
export function isCredentialTargetId(value) {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(CREDENTIAL_TARGETS, value);
}
export function isConfigCredentialTarget(id) {
    return id !== "onePasswordToken";
}
/** Where a card saves what the person typed: the 1Password token goes to Logins, which checks it reaches 1Password. */
export function credentialSaveRequest(id, value) {
    return isConfigCredentialTarget(id)
        ? { path: "/api/config", method: "PUT", body: credentialConfigPatch(id, value) }
        : { path: "/api/logins/1password", method: "POST", body: { token: value } };
}
export function credentialConfigPatch(id, value) {
    switch (id) {
        case "xaiApiKey":
            return { xai: { key: value } };
        case "boxToken":
            return { box: { token: value } };
        case "opencodeGoApiKey":
            return { opencodeGo: { apiKey: value } };
        case "ttsKey":
            return { tts: { key: value } };
        case "fishAudioKey":
            return { tts: { fishKey: value } };
        case "openaiImageApiKey":
            return { imageGen: { key: value } };
    }
}
export function credentialIsConfigured(config, id) {
    switch (id) {
        case "xaiApiKey":
            return Boolean(config.xai?.key);
        case "boxToken":
            return Boolean(config.box?.token);
        case "opencodeGoApiKey":
            return Boolean(config.opencodeGo?.apiKey);
        case "ttsKey":
            return Boolean(config.tts?.key);
        case "fishAudioKey":
            return Boolean(config.tts?.fishKey);
        case "openaiImageApiKey":
            return Boolean(config.imageGen?.key);
        case "onePasswordToken":
            return Boolean(config.onePassword?.connected);
    }
}
/** A still-pending credential card for this target — the set a newer
 * request supersedes. Provided, dismissed, and already-superseded cards
 * keep their settled state untouched. */
export function isPendingCredentialRequest(message, target, requestingBotId, roomThread) {
    return (message.kind === "secret" &&
        message.secret?.target === target &&
        message.secret.provided !== true &&
        message.secret.dismissed !== true &&
        message.secret.superseded !== true &&
        (!roomThread || message.from?.botId === requestingBotId));
}
export function credentialResumeOutcome(state) {
    const provided = state.provided === true;
    const dismissed = state.dismissed === true;
    if (provided === dismissed)
        return null;
    return provided ? "provided" : "dismissed";
}
