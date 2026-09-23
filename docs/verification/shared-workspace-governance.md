# Shared-workspace governance: bot visibility and admin activity

Two things an admin of a workspace several people share needs: to keep a bot
(HR, finance) away from members who should not see it, and to see who changed
what. The operator-facing description is in
[self-hosting](../self-hosting.md#who-can-see-a-bot) and
[admin activity](../self-hosting.md#admin-activity). Neither adds a card,
prompt or dialog: visibility is access control and the log is a record.

## Sub-features

- **Per-bot visibility.** `PATCH /api/bots/:id` takes `visibility`:
  `"everyone"` (default), `"admins"`, or `{ "people": [emails or @domains] }`
  (admins always included). Members' PATCHes may not set it (the client
  body filter in `server/request-auth.ts`). The rules live in
  `server/bot-visibility.ts`; `server/index.ts` applies them:
  - one gate for every path naming a bot, thread, room, routine, run or
    attachment (`pathSubject` / `subjectVisible`): a hidden one answers 404
    exactly like an unknown id;
  - narrowed lists: `GET /api/bots` (bots, rooms, teams, queued lines,
    computer state), `/api/search`, `/api/routines`, `/api/webhooks`,
    `/api/team-map`; `POST /api/groups` and routine create/edit refuse a
    hidden bot or room;
  - the live stream: each member stream is narrowed frame by frame
    (`frameForMember`), including replay on reconnect; a bot or room that
    becomes hidden is withdrawn once (`bot.deleted` / `group.deleted`), one
    that becomes visible arrives whole with a transcript page;
  - rooms need every bot visible; teams need a visible bot or room;
  - bots reach teammates only with exactly the same audience
    (`peerAllowed` in `server/peer-roster.ts`, used by rosters, `list_bots`,
    asks, delegations, @mentions and the Chief's team);
  - admins, the owner on this machine and a session-less local service see
    everything; members never receive a bot's audience list.
- **Admin activity log.** `server/admin-activity.ts`. Each successful admin
  change is diffed around its request (config.json, the bot's audited
  fields, the bot and webhook lists, sessions, pairing codes, engine actions)
  and written to `<data>/admin-activity/YYYY-MM.ndjson` (0600) with the
  actor and redacted before/after values; `openmausbot access` writes the
  same row as the command line. Months are pruned by the decision log's
  retention window. The packaged desktop app records nothing.
- **Activity view.** `GET /api/admin-activity?from=&to=&who=&what=&limit=`
  and `GET /api/admin-activity.csv` (admin only) merge the admin rows with the
  decision log's answered cards (`what=decisions` adds automatic ones).
  **Settings → Activity** shows them with who / what / when filters and a CSV
  link, for admins in a browser.

## Driving it

```sh
pnpm exec vitest run server/bot-visibility.test.ts server/bot-visibility.e2e.test.ts \
  server/admin-activity.test.ts server/admin-activity.e2e.test.ts server/peer-roster.test.ts \
  server/cli.test.ts src/components/ActivitySection.test.ts \
  src/components/bot-settings/VisibilitySection.test.ts
```

- `server/bot-visibility.e2e.test.ts` boots a server with an admin (Boss) and
  two members (Ada, Bob) on the sign-in list and the fake ACP engine. Boss
  restricts "Payroll" to Ada and "Board" to admins, puts Payroll in a room
  with an everyone-visible bot, gives it a routine, a webhook, an image in
  its thread and an avatar. As Bob it checks the bot list (bots, rooms,
  teams, computer state), 24 routes to Payroll, its thread, its room, its
  routine and its files (all 404, nothing changed behind them), room and
  routine creation, search, routines, webhooks and the team map; as Ada the
  same routes work; Boss and the owner on loopback see everything. Two live
  streams (Ada, Bob) watch a turn in Payroll's thread (Ada sees it, Bob sees
  nothing naming it), then Boss adds Bob (Payroll, its room and its team
  arrive) and makes it admins-only (both streams get `bot.deleted` and
  `group.deleted`, and later changes to it send them nothing). Finally, two
  bots with the same audience are teammates and a bot with a different one
  is not, in the real system prompt.
- `server/admin-activity.e2e.test.ts` changes people, an engine key, a spend
  limit and settings (as Boss, as the owner on loopback, and with the
  command-line marker), adds an MCP server with a secret, creates, restricts,
  re-permissions and deletes a bot, creates and deletes a webhook, revokes a
  session and creates a pairing code; then reads `GET /api/admin-activity`
  with each filter and the CSV. It checks who is named, that display-only
  and refused changes leave no row, that neither secret reaches the file or
  the CSV, that the file is 0600, and that a member gets 403.
- `server/cli.test.ts` ("openmausbot access") checks the command line's rows.

## Not proven here

- The Settings screens (Activity, Who can see it) were checked by rendering
  and unit tests, not in Electron or a browser against a live server.
- No hosted tenant, portal membership, Slack worker or cloud Admin was
  involved; portal admin sessions carry the same `admin` scope the tests use.
- The live stream's narrowing costs one visibility check per frame per
  member stream while a bot is restricted; it was not load-tested.
- Words already quoted into a visible conversation (an earlier delegation
  result) are not removed when a bot is restricted later.

## Observed local result — 2026-09-23

On a disposable worktree stacked on #1708 and rebased onto OpenMausBot main
`0b132aec`: `pnpm typecheck`, `pnpm lint`, `pnpm i18n:check` and the files
above passed. Before that rebase (main `0bb37982` plus #1708),
`pnpm test:packaged-server` and `server/index.test.ts`,
`server/independent-threads-api.test.ts`,
`server/notification-routing.e2e.test.ts`, `server/comms.test.ts`,
`server/guarded-messages-api.test.ts`,
`server/paired-thread-targets-api.test.ts`, `server/chief-rooms.e2e.test.ts`,
`server/direct-coordination.e2e.test.ts`, `server/request-auth.test.ts`,
`server/decision-log.test.ts`, `server/decision-log-wiring.test.ts`,
`server/card-answerers.e2e.test.ts`, `server/peer-allowlist.e2e.test.ts`,
`server/delegations.test.ts`, `server/chief-of-staff.test.ts`,
`server/thread-capacity-api.test.ts`, `server/cli-service-trust.e2e.test.ts`
and the Settings/People/session UI tests passed on macOS.
`server/hosted-access.test.ts` passed except once for its 8-second licence
expiry case, which failed under load and passed when rerun alone.

Mutation checks, each restored afterwards, turned a named test red: the
per-path gate off; the bot list unfiltered; the live stream unfiltered;
withdrawal (`bot.deleted`) never sent; rooms needing any rather than every
bot; the same-audience rule off; search, webhooks, attachments, room
creation or routine targets unchecked; a member's copy of a bot keeping its
audience list; refused admin requests still logged; secrets not hidden in
the log; the command line not named; the activity routes readable by
members. Every server, session and engine was a local fixture. This is not
production qualification: no hosted tenant, portal, Slack worker, cloud
Admin or real email was involved.
