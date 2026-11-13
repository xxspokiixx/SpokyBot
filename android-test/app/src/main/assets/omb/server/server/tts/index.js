import { voiceCredential } from "../included-services.js";
import * as chatterbox from "./chatterbox.js";
import * as elevenlabs from "./elevenlabs.js";
import * as grok from "./grok.js";
import * as fish from "./fish.js";
import * as systemVoices from "./system-voices.js";
export class NoVoiceConfigured extends Error {
    // Not a parameter property: the harness runs under strip-only `node --experimental-strip-types`, which rejects one at load.
    reason;
    constructor(reason, hint) {
        super(hint ??
            (reason === "key"
                ? "Add an ElevenLabs key in Settings on the computer to turn on voice."
                : "Pick a voice in the agent profile."));
        this.reason = reason;
    }
}
const elevenLabs = (cfg) => voiceCredential(cfg.tts?.key);
export function voiceProvider(cfg) {
    const provider = cfg.tts?.provider;
    return provider === "xai" || provider === "fish" || provider === "system" || provider === "chatterbox" ? provider : "elevenlabs";
}
export function providerConfigured(cfg) {
    const provider = voiceProvider(cfg);
    if (provider === "xai")
        return Boolean(cfg.xai?.key);
    if (provider === "system")
        return systemVoices.systemVoicesAvailable();
    if (provider === "chatterbox")
        return Boolean(cfg.tts?.baseUrl?.trim());
    if (provider === "fish")
        return Boolean(cfg.tts?.fishKey);
    return Boolean(elevenLabs(cfg));
}
export function voiceConfigured(cfg) {
    const provider = voiceProvider(cfg);
    if (provider === "xai")
        return Boolean(cfg.xai?.key && cfg.tts?.voice);
    if (provider === "system") {
        return systemVoices.systemVoicesAvailable() && Boolean(cfg.tts?.voice);
    }
    if (provider === "chatterbox")
        return Boolean(cfg.tts?.baseUrl?.trim() && cfg.tts?.voice);
    if (provider === "fish")
        return Boolean(cfg.tts?.fishKey && cfg.tts?.voice);
    return Boolean(elevenLabs(cfg) && cfg.tts?.voice);
}
export function voiceReady(cfg, voiceId) {
    const provider = voiceProvider(cfg);
    if (provider === "xai")
        return Boolean(cfg.xai?.key && (voiceId || cfg.tts?.voice));
    if (provider === "system") {
        return systemVoices.systemVoicesAvailable() && Boolean(voiceId || cfg.tts?.voice);
    }
    if (provider === "chatterbox")
        return Boolean(cfg.tts?.baseUrl?.trim() && (voiceId || cfg.tts?.voice));
    if (provider === "fish")
        return Boolean(cfg.tts?.fishKey && (voiceId || cfg.tts?.voice));
    return Boolean(elevenLabs(cfg) && (voiceId || cfg.tts?.voice));
}
/** Never includes the key. */
export function describeVoice(cfg) {
    const provider = voiceProvider(cfg);
    const included = provider === "elevenlabs" && elevenLabs(cfg)?.included === true;
    return {
        configured: providerConfigured(cfg),
        ready: voiceConfigured(cfg),
        voice: cfg.tts?.voice ?? "",
        provider,
        baseUrl: provider === "chatterbox" ? (cfg.tts?.baseUrl ?? "") : "",
        model: provider === "chatterbox" ? (cfg.tts?.model ?? "") : "",
        ...(provider === "fish" ? { fishModel: cfg.tts?.fishModel ?? fish.DEFAULT_FISH_MODEL } : {}),
        ...(included ? { included: true } : {}),
    };
}
export function verifyKey(provider, key) {
    return provider === "fish" ? fish.verifyKey(key) : elevenlabs.verifyKey(key);
}
export async function listVoices(cfg, run, search) {
    const provider = voiceProvider(cfg);
    if (provider === "xai")
        return cfg.xai?.key ? grok.listVoices(cfg.xai.key) : [];
    if (provider === "system")
        return systemVoices.listSystemVoices(run);
    if (provider === "chatterbox") {
        const baseUrl = cfg.tts?.baseUrl?.trim();
        return baseUrl ? chatterbox.listChatterboxVoices(baseUrl) : [];
    }
    if (provider === "fish") {
        const key = cfg.tts?.fishKey;
        return key ? fish.listVoices(key, search) : [];
    }
    const credential = elevenLabs(cfg);
    if (!credential)
        return [];
    return elevenlabs.listVoices(credential.token, credential.api, search);
}
export async function addSharedVoice(cfg, publicOwnerId, voiceId, name) {
    const credential = voiceProvider(cfg) === "elevenlabs" ? elevenLabs(cfg) : null;
    if (!credential)
        throw new NoVoiceConfigured("key");
    return elevenlabs.addSharedVoice(credential.token, credential.api, publicOwnerId, voiceId, name);
}
export function speak(cfg, text, voiceId, run) {
    const provider = voiceProvider(cfg);
    if (provider === "xai") {
        const key = cfg.xai?.key;
        if (!key)
            throw new NoVoiceConfigured("key", "Add an xAI key in Settings to use Grok voice.");
        const voice = voiceId || cfg.tts?.voice;
        if (!voice)
            throw new NoVoiceConfigured("voice");
        return grok.synthesize(text, voice, key);
    }
    if (provider === "system") {
        const voice = voiceId || cfg.tts?.voice;
        if (!systemVoices.systemVoicesAvailable() && !run)
            throw new NoVoiceConfigured("key");
        if (!voice)
            throw new NoVoiceConfigured("voice");
        return systemVoices.synthesizeSystem(text, voice, run);
    }
    if (provider === "chatterbox") {
        const baseUrl = cfg.tts?.baseUrl?.trim();
        if (!baseUrl) {
            throw new NoVoiceConfigured("key", "Add the address of your Chatterbox server in Settings on the computer to turn on voice.");
        }
        const voice = voiceId || cfg.tts?.voice;
        if (!voice)
            throw new NoVoiceConfigured("voice");
        return chatterbox.synthesizeChatterbox(text, voice, baseUrl, cfg.tts?.model);
    }
    if (provider === "fish") {
        const key = cfg.tts?.fishKey;
        if (!key) {
            throw new NoVoiceConfigured("key", "Add a Fish Audio key in Settings on the computer to turn on voice.");
        }
        const voice = voiceId || cfg.tts?.voice;
        if (!voice)
            throw new NoVoiceConfigured("voice");
        return fish.synthesize(text, voice, key, cfg.tts?.fishModel);
    }
    const credential = elevenLabs(cfg);
    if (!credential)
        throw new NoVoiceConfigured("key");
    const voice = voiceId || cfg.tts?.voice;
    if (!voice)
        throw new NoVoiceConfigured("voice");
    return elevenlabs.synthesize(text, voice, credential.token, credential.api).audio;
}
