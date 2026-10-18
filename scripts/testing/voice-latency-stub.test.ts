import { describe, expect, it } from "vitest";
import { SYNTHESIS } from "./voice-latency-corpus.ts";
import {
  launchVoiceLatencyStub,
  silenceMp3,
  STUB_MODEL,
  STUB_VOICE,
  synthesisDelayMs,
} from "./voice-latency-stub.ts";

const FRAME_MS = 1152 / 44.1;
const FRAME_BYTES = 208;

describe("voice latency record stub", () => {
  it("models synthesis at the manifest's pinned RTF and clip rate", () => {
    expect(SYNTHESIS).toEqual({ rtf: 0.5, audioMsPerChar: 70 });
    // The review's worst first block: 319 chars → 11.2 s of synthesis.
    expect(synthesisDelayMs(319)).toBe(11_165);
  });

  it("builds silent mp3 clips whose frame count carries the modeled duration", () => {
    for (const chars of [12, 26, 92, 211, 319]) {
      const bytes = silenceMp3(chars * SYNTHESIS.audioMsPerChar);
      expect(bytes.length % FRAME_BYTES).toBe(0);
      expect([...bytes.subarray(0, 4)]).toEqual([0xff, 0xfb, 0x50, 0xc0]);
      // Every frame is the same header; the count is the duration the browser plays.
      const frames = bytes.length / FRAME_BYTES;
      expect(Math.abs(frames * FRAME_MS - chars * SYNTHESIS.audioMsPerChar)).toBeLessThanOrEqual(FRAME_MS / 2);
    }
  });

  it("serves the ElevenLabs wire shape with the modeled delay, keyless", async () => {
    const stub = await launchVoiceLatencyStub();
    try {
      const voices = await fetch(`${stub.url}/voices`);
      expect(voices.status).toBe(200);
      const body = (await voices.json()) as { voices?: Array<{ voice_id?: string }> };
      expect(body.voices?.[0]?.voice_id).toBe(STUB_VOICE);

      const chars = 8;
      const began = Date.now();
      const spoken = await fetch(`${stub.url}/text-to-speech/${STUB_VOICE}?output_format=mp3_44100_64`, {
        method: "POST",
        headers: { "xi-api-key": "ignored-by-design", "content-type": "application/json" },
        body: JSON.stringify({ text: "a".repeat(chars), model_id: STUB_MODEL }),
      });
      const elapsed = Date.now() - began;
      expect(spoken.status).toBe(200);
      expect(spoken.headers.get("content-type")).toBe("audio/mpeg");
      // The response is held back for the modeled synthesis time, no shorter.
      expect(elapsed).toBeGreaterThanOrEqual(synthesisDelayMs(chars) - 25);
      const bytes = Buffer.from(await spoken.arrayBuffer());
      expect(bytes.length).toBe(Math.round((chars * SYNTHESIS.audioMsPerChar) / FRAME_MS) * FRAME_BYTES);
    } finally {
      await stub.close();
    }
  });

  it("rejects a speak request without text", async () => {
    const stub = await launchVoiceLatencyStub();
    try {
      const spoken = await fetch(`${stub.url}/text-to-speech/${STUB_VOICE}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "" }),
      });
      expect(spoken.status).toBe(400);
    } finally {
      await stub.close();
    }
  });
});
