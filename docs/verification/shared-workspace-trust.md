# Shared-workspace trust: loopback, card answerers, decision log

A hosted or shared workspace runs every bot's shell on the server as the
same user, so "a request from 127.0.0.1" no longer means "the owner". These
checks pin what changes there and what does not. The operator-facing
description is in [self-hosting](../self-hosting.md#loopback-trust-owner-or-service).

## Sub-features

- **Loopback trust.** At start-up the server logs `local requests: owner
  trust (…)` or `local requests: service trust (…)`. A hosted workspace (any
  `OMB_ADMIN_*` setting) or `OMB_SHARED_WORKSPACE_FULL_ACCESS=1` defaults to
  `service`; a self-hosted server keeps `owner`; `OMB_LOOPBACK_TRUST=owner|
  service` overrides (anything else means `service`); the desktop app always
  keeps `owner` behind its per-launch capability. Under `service` a
  session-less loopback request may use only `SERVICE_ALLOW`
  (`server/request-auth.ts`): health, who-am-I, edition, brand, the bot list,
  thread messages, attachments, new threads, the guarded send, the exact
  request fence and its stop, withdrawing a queued line, `POST
  /api/threads/:id/respond` (decline only), and the bots' capability routes
  under `/api/internal/*`. Everything else answers 403. That is exactly the
  set the cloud Slack worker calls (`openmaus-cloud server/slack-worker.ts`,
  every released version), so the deployed worker needs no change.
- **Who may answer a card.** With portal membership or an email sign-in list
  that names members, a member session may answer a card only on a thread it
  started (`POST /api/bots/:id/tasks` or a room thread, recorded as a
  server-private opaque key) or for a request it sent (the user message the
  harness proved started the turn, by `sender.id`). Admins and the owner may
  answer any card; a `service` caller may only decline. This applies to both
  respond routes and to "always allow". It adds no card, prompt or gate: the
  provider CLI's own approval is the card.
- **Who answered.** Each card a person or service settles records
  `card.answeredBy` (`{kind:"session", name}`, `{kind:"loopback"}` or
  `{kind:"worker"}`), and its `user-approved` / `user-denied` decision row
  records `actor` (session id, device label, email, and account id when it is
  not a portal grant).
- **Decision log retention.** Rows go to `<data>/decisions/YYYY-MM.ndjson`. A
  month file is deleted once all of it is older than the window (180 days by
  default; `decisions.retentionDays` or `OMB_DECISION_RETENTION_DAYS`). An
  older server's `decisions.ndjson` and `.1` are still read and age out by
  their last write. `GET /api/decisions?limit=` is unchanged; `GET
  /api/decisions.csv?from=&to=` (admin) exports a date range with formula
  cells neutralised and secrets redacted.
- **Settings on a portal-membership workspace.** `GET /api/config` reports
  `membership {authority, pairingCodes, peopleUrl}`. Settings → People turns
  read-only (who signed in, their spend, "Manage people in Admin" linking to
  `<OMB_ADMIN_URL>/people?workspace=<slug>`); Remote access offers no pairing
  code and says people sign in through the organisation's portal.

## Driving it

```sh
pnpm exec vitest run server/request-auth.test.ts server/decision-log.test.ts \
  server/card-answerers.e2e.test.ts server/hosted-access.test.ts \
  server/decision-log-wiring.test.ts server/hosted-models-api.test.ts \
  src/components/PeopleSection.test.ts src/components/ServerPairingCard.test.ts src/lib/session.test.ts
```

- `request-auth.test.ts` runs the worker's calls and a list of admin calls
  through the resolver under each trust level, sessions under `service`, the
  desktop capability overriding `service`, and the start-up choice matrix.
- `hosted-access.test.ts` ("treats a session-less local caller as a service by
  default") boots a portal-membership workspace with shared Full access and no
  override: the start-up log line, the worker's whole path over loopback
  (health, bot list, a Full-access thread, a guarded send, its request fence),
  403 for `PUT /api/config`, `POST /api/webhooks`, session list and
  revocation, bot creation and loosening, and an unguarded send, with nothing
  changed afterwards; then an admin portal session saves the retention window
  and reads `membership`. The other cases in that file keep
  `OMB_LOOPBACK_TRUST=owner` because they set fixtures up over loopback.
- `card-answerers.e2e.test.ts` boots a server with one admin and two members
  on the sign-in list and the fake ACP engine asking permission every turn:
  another member is refused on both respond routes, the requester approves,
  the thread's starter declines someone else's request, an admin and the owner
  answer anyone's card, and under `OMB_LOOPBACK_TRUST=service` a session-less
  caller cannot approve (or use the bot-scoped route or always-allow) but can
  decline. Each answer's decision row and card name who answered.

## Not proven here

- The live Slack worker was not run against this build; its calls are pinned
  from its source and exercised route by route above.
- "Always allow" by a refused member is covered by code, not by the fake
  engine, whose cards carry no allow key.
- A bot shell under `service` trust can still post through the guarded route,
  open threads (Full-access ones when the operator enabled that), stop a
  request and decline a card, and can read files its user owns. Those are
  documented residual risks, not regressions.
- The Settings screens were checked by server-side rendering, not in Electron
  or a browser.

## Observed local result — 2026-09-23

On a disposable worktree from OpenMausBot main `c61d7c86`: `pnpm typecheck`,
`pnpm lint`, `pnpm i18n:check`, `pnpm test:packaged-server`, and the files
above plus `server/index.test.ts`, `server/steer-e2e.test.ts`,
`server/enterprise.test.ts`, `server/hosted-slack.test.ts`,
`enterprise/server/workspace-access.test.ts`, `server/store.test.ts`,
`server/config.test.ts`, the steer and channel queues and the fleet tests
passed. Mutation checks, each restored afterwards, turned a named test red:
the resolver ignoring `service`; a hosted workspace defaulting to `owner`; the
server gate not passing the trust level; members answering any card; a
service approving; task creation not recording its starter; decision rows
without the answerer; month pruning off by one month; the portal People table
offering edits. Every server, session, engine and identity service was a
local fixture. This is not production qualification: no hosted tenant, Slack
worker, Admin or real email was involved.
