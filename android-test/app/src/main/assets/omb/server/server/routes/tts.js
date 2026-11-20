import { redactSecretsInText } from "../redact.js";
import * as tts from "../tts/index.js";
import { toUtterances, VOICE_FIRST_BLOCK_MAX_CHARS } from "../tts/speech-text.js";
import { PASS } from "./table.js";
export function createTtsRoutes(deps) {
    return async ({ req, res, url, path, method, json, readBody }) => {
        if (!path.startsWith("/api/tts/"))
            return PASS;
        const cfg = deps.config();
        if (method === "POST" && path === "/api/tts/prepare") {
            const body = await readBody(req);
            // Replies speak while they are still being written, from text no stored message has scrubbed yet: held secrets
            // are known only here, so they are masked here. The first block is short so the first sound comes soon.
            const text = redactSecretsInText(String(body.text ?? ""));
            return json(res, 200, {
                ready: tts.voiceReady(cfg, typeof body.voiceId === "string" ? body.voiceId : undefined),
                utterances: toUtterances(text, { firstBlockMaxChars: VOICE_FIRST_BLOCK_MAX_CHARS }),
            });
        }
        if (method === "GET" && path === "/api/tts/voices") {
            try {
                const search = {
                    query: url.searchParams.get("q")?.slice(0, 200),
                    current: url.searchParams.get("current") ?? undefined,
                };
                return json(res, 200, { voices: await tts.listVoices(cfg, undefined, search) });
            }
            catch (e) {
                return json(res, 200, { voices: [], error: e instanceof Error ? e.message : String(e) });
            }
        }
        if (method === "POST" && path === "/api/tts/voices/add") {
            const body = await readBody(req);
            const id = (value) => (typeof value === "string" && /^[A-Za-z0-9]{1,128}$/.test(value) ? value : "");
            const publicOwnerId = id(body.publicOwnerId);
            const voiceId = id(body.voiceId);
            const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
            if (!publicOwnerId || !voiceId || !name)
                return json(res, 400, { error: "publicOwnerId, voiceId and name required" });
            try {
                return json(res, 200, { voiceId: await tts.addSharedVoice(cfg, publicOwnerId, voiceId, name) });
            }
            catch (e) {
                return json(res, 502, { error: e instanceof Error ? e.message : String(e) });
            }
        }
        if (method === "POST" && path === "/api/tts/speak") {
            const body = await readBody(req);
            const text = String(body.text ?? "").trim();
            if (!text)
                return json(res, 400, { error: "text required" });
            // A hard ceiling, so an arbitrary local request cannot turn the hosted voice account into an unbounded billable job.
            if (text.length > 500)
                return json(res, 413, { error: "voice utterances are limited to 500 characters" });
            try {
                const audio = await tts.speak(cfg, text, typeof body.voiceId === "string" ? body.voiceId : undefined);
                res.writeHead(200, {
                    "content-type": audio.mime,
                    "content-length": String(audio.bytes.byteLength),
                    "cache-control": "no-store",
                });
                res.end(Buffer.from(audio.bytes));
                return;
            }
            catch (e) {
                if (e instanceof tts.NoVoiceConfigured)
                    return json(res, 409, { error: e.message });
                return json(res, 502, { error: e instanceof Error ? e.message : String(e) });
            }
        }
        return PASS;
    };
}
