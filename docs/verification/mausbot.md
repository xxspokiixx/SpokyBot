# MausBot, everyone's helper

MausBot is the bot every place and every Team Cloud member gets once: a new
install's first bot and its Chief of Staff, or, for an install that already has
bots, a helper beside them. It is never deleted or archived; the person takes it
off the sidebar with "Show MausBot in the sidebar" in Settings → General, which
its menu's **Hide from sidebar** also turns off.

## Automated checks

```sh
pnpm exec vitest run server/default-bot.test.ts server/default-bot.e2e.test.ts \
  server/team-setup-requests.test.ts src/lib/default-bot.test.ts src/components/MausBotWelcome.test.ts
```

- `server/default-bot.test.ts`: a fresh install gets one MausBot once; an
  existing install gets one once on update and its Chief is untouched; a new
  install's renamed MausBot is adopted, not duplicated; the intro shows once,
  not after it was answered or dismissed; delete and archive are refused; a
  move to My Cloud and coming home leave exactly one; each Team Cloud member
  gets their own; a Team User's MausBot holds no Chief tools.
- `server/default-bot.e2e.test.ts`: on a real fixture server, `DELETE
  /api/bots/:id` answers 409, the switch hides and shows it, and a MausBot that
  is not the Chief creates a bot with `create_bot`.
- `server/team-setup-requests.test.ts` ("MausBot's Chief-level team setup"):
  it adds specialists like a Chief but never changes who the Chief is.
- `src/components/MausBotWelcome.test.ts` and `src/lib/default-bot.test.ts`:
  the first-launch welcome shows once, Add pins it and Not now turns the switch
  off, and a new install's intro offers only the setup still to do.

## By hand

Launch the app against an isolated fixture (`docs/verification/README.md`),
finish the first-run welcome and its tour, then:

1. The **Meet MausBot** popup appears once. Change its name, colour or look;
   **Add MausBot** flies it into the top of the sidebar, pinned. Reopen the app:
   it does not appear again.
2. MausBot's first message says what it does in the app's language, with
   example asks and, on a new install, only the setup steps still to do. Each
   step opens the app's own flow.
3. Its sidebar menu offers **Hide from sidebar**, not Archive or Delete; the
   switch in Settings → General brings it back.

Evidence: [popup, light](evidence/mausbot/welcome-light.png),
[popup, dark](evidence/mausbot/welcome-dark.png),
[the fly-in](evidence/mausbot/fly-in.gif),
[intro and setup](evidence/mausbot/added-light.png),
[menu](evidence/mausbot/menu-light.png),
[Settings, switched off](evidence/mausbot/settings-off.png),
[Chrome, light](evidence/mausbot/chrome-variants-daylight.png),
[Chrome, dark](evidence/mausbot/chrome-variants-midnight.png).
