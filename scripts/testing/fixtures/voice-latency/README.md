# Voice latency corpus and measurement

A committed corpus fixture and a measurement harness for the voice-reply
pipeline: the harness drives the real app pipeline against the corpus and
writes a run log, so a speak-pipeline change can be judged on identical
replays before and after it.

## Files

- `corpus.json` — the adversarial corpus (canonical form, trailing newline).
  `corpusFixtureId` = sha256 of this exact file.
- `manifest.json` — fixture ID, per-reply char/block counts from the real
  `toUtterances` splitter (`server/tts/speech-text.ts`), shape pins, totals.
- `logs/before-<sha12>.json` — the baseline run, recorded before any of the
  speak-pipeline changes. A later after-run lands beside it as
  `logs/after-<sha12>.json` with the same corpus sha in the name.

Regenerate (must reproduce the committed bytes exactly):

```
node --experimental-strip-types scripts/testing/voice-latency-corpus.ts
```

## Shapes

Pinned first blocks (verified by `voice-latency-corpus.test.ts` against the
real splitter): unpunctuated run 319, code list 211, em-dash list 153, typical
medium 26, staccato one 92-char block, mixed reply whose last block is 319.
Totals: 116 blocks, mean ~66 chars.

## Protocol

Delta replay cadence, identical on both sides: `FAKE_CLAUDE_STREAM_CADENCE`
(server/testing/fake-claude-cli.ts) streams each scripted reply as 24-char
`text_delta` chunks every 150 ms (160 chars/s) before the assistant message.
Injection point: the fake claude CLI's turn output — the real driver
(server/drivers/claude.ts stream_event → content.delta) forwards it, the
server broadcasts {kind:"runtime"} frames, and the renderer store records
arrival (src/lib/voice-latency-probe.ts, enabled only by `?ombVoiceProbe=1`
on the preview page).

Reply routing is by prompt marker, not ordered slots: the harness POSTs
`omb voice probe <id>` as the user text and the fake CLI answers with that
marker's corpus reply (`FAKE_CLAUDE_MARKER_REPLIES`). The driver legitimately
replays a user message over several CLI launches; marker routing makes every
replay answer the same reply, so rows align regardless of replay count. A
turn settles only after its own reply's full-length complete frame plus 4
quiet 500 ms polls; the audio frame is the fresh frame whose `textChars`
equals the corpus reply's length.

t0 = arrival of the first `content.delta` runtime frame for the turn. First
audio = `play()` resolving on block 0. A gap is a silence between the end of
block j and the start of block j+1 longer than 200 ms, counted after first
audio, within one reply.

Instrumentation is inert without the probe sink: with the harness disabled, the
speak path and the discard-delta behavior (src/state/store.tsx
runtimeFrameAction / case "runtime") are byte-for-byte the shipped path.
src/state/store.test.ts and src/lib/tts/index.test.ts pin that.

## Run

```
node --experimental-strip-types scripts/testing/voice-latency-harness.ts --label before
```

One warmup reply is spoken and discarded, then every corpus reply in order.
Each log row: reply id, shape, t0-to-first-audio ms, gap count, total gap ms,
longest gap ms (plus t0→message-frame and message-frame→first-audio splits).
The summary carries worst-case first audio, total gaps, single longest gap,
corpus fixture ID, base commit, measured-build commit, date, machine, and the
config summary (provider/model/voice name only — keys are never logged).

The harness reads the live `~/.openmausbot/config.json` tts section and copies
it into the disposable fixture server (loopback only, torn down after the run);
it never modifies the live config. Resolution: key from `OMB_TTS_KEY` (the
installed app keeps its key outside config.json), voice from config, then
`OMB_TTS_VOICE`, then the first bot voice in `~/.openmausbot/bots.json` (the
live config ships `voice: ""`); model from config, then `OMB_TTS_MODEL`, then
`eleven_flash_v2_5`. For plumbing checks against a fake provider,
`OMB_ELEVENLABS_API` points the fixture server at a stub instead of
api.elevenlabs.io.
Deterministic pieces (corpus regeneration, manifest consistency, gap
accounting) are unit-tested; the live measurement itself is a run, not a test.
