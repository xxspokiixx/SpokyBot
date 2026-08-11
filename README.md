# OpenGrokBot

An open clone of the **Grok Bot** macOS app — a Telegram-style chat manager
for AI bots, where every bot is a real agent running on the provider of your
choice.

## How it works

Two processes:

- **Harness server** (`server/`, port 8799) — owns every provider process.
  A driver registry turns instance configs into live provider instances
  (Grok over the xAI API, Claude and Codex over their local CLIs, and a
  cloud-computer agent). Every driver's native protocol is normalized into
  one canonical runtime event stream, which is logged per-thread as NDJSON,
  folded into persistent transcripts, and fanned out to clients over SSE.
- **App** (`src/`, port 5199) — React + Tailwind. Holds no transports of its
  own: it sends typed commands over HTTP (`/api/...`, proxied by Vite) and
  folds the one SSE stream into local state.

Features wired end-to-end:

- **Sidebar** — bot list with squishy blob avatars, previews, unread dots,
  new-bot button, Plugins + profile footer
- **Chat** — streaming replies (token deltas), tool-run activity chips,
  approval/question cards answered inline, screenshots of the bot's cloud
  computer, stop button
- **Model selector** — in the chat header and in Settings: per-instance rail
  with provider marks, model list with defaults, unavailable providers shown
  disabled with the reason (missing API key, CLI not installed, …)
- **Settings** — per-bot Name / Title / Description (become the bot's system
  prompt), model selection, Notifications toggle
- **Plugins** — Composio connectors + the bot's cloud computer (Box)

## Run

```sh
pnpm install
pnpm dev:server   # harness server on http://127.0.0.1:8799
pnpm dev          # app on http://localhost:5199 (proxies /api to the server)
pnpm dev:desktop  # Electron shell (loads the dev URL)
```

Provider setup (`~/.opengrokbot/config.json`, all optional — configured
providers just light up in the model picker):

```json
{
  "xai": { "key": "xai-…" },
  "composio": { "key": "ck_…" },
  "box": { "token": "…" }
}
```

Claude and Codex need their CLIs (`claude`, `codex`) installed and logged in.

```sh
pnpm typecheck    # app + server
pnpm build        # typecheck + production build
```
