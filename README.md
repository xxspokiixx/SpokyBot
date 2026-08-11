# OpenGrokBot

An open skeleton clone of the **Grok Bot** macOS app — a Telegram-style chat
manager for AI bots. UI structure borrowed from the t3code web app's chat shell
(React + Tailwind + lucide), rebuilt as a standalone Vite app.

## Current skeleton

- **Sidebar** — search, bot list with squishy blob avatars, message previews,
  unread dots, new-bot button, Plugins + profile footer
- **Chat pane** — bot header, date separator, message bubbles, interactive
  onboarding option cards (A/B/C/D + free-text answer), pill composer with
  attach + mic
- **Settings panel** — per-bot Name / Title / Description and a Notifications
  toggle ("get notified when this agent finishes or needs input")

State is local React (`src/state/store.tsx`) with seeded bots — no backend yet.

## Run

```sh
pnpm install
pnpm dev        # http://localhost:5199
pnpm build      # typecheck + production build
```

## Roadmap

- Wire bots to a real model backend (streaming responses)
- Plugins panel, bot directory, voice mode
- Electron wrapper for a real macOS app
- Notifications when an agent finishes or needs input
