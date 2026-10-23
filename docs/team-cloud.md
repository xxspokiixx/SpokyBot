# Team Clouds: the `team` role and the audience rule

A **Team Cloud** is one Cloud machine several people use: the shared home of a team's bots. The Admin
(openmaus-cloud, `docs/team-cloud.md` there) makes it, invites people and signs each person's pairing. This page is the
machine's side: what the `team` role changes against a My Cloud ([cloud-pro.md](cloud-pro.md)), and the one rule that
keeps people apart on it. The bot box ([bot-box.md](bot-box.md)) is what makes that rule hold against a bot with a shell.

## What a team sees

- **Signing in.** Each person pairs from the app with a link the Admin signs for them; the machine shows the team's name
  wherever a server names itself. Owners and Admins get everything an admin session can do (Super admin and Admin in the
  app); a Member (User) chats with the team's bots, uses rooms and makes routines, and changes no bot's setup, connects
  no app and makes no webhook.
- **Conversations.** A bot's main chat is the team's: everyone who sees the bot reads and writes it. "New conversation"
  is yours: you and the Admins see it, other Members never do, in lists, searches, files or streams. A group chat is seen
  by whoever sees it. Every private chat says so in its header, *"Private · admins can see"*, and the first one on a
  device also says it as a sentence: *"Chats in Acme are private from other members. Acme's admins can see them."* The
  server marks such a conversation `private: true` on the wire (`WireTask.private`).
- **Memory.** Each bot keeps three kinds of notes: the team's, a group chat's and a person's. A turn reads the team's notes and
  the notes of where it is, and saves into where it is. What you tell a bot privately never reaches a room or another
  person's chat; what a group chat decides never reaches your private chat. "About you" is yours alone: `GET`/`PUT /api/me`
  (the app's Profile on a team), read into your own conversations only.
- **Connected apps.** The team's connections (Composio, HighLevel, MCP sign-ins, an AI key an Admin saved) belong to the
  Team Cloud and serve every member's turn through the broker. An Admin can instead make an app or an MCP server *each
  person's own* (below): then every member connects their own, and only their own private chats use it. A person's
  connections from elsewhere have no way in: a share code, a moved MCP sign-in or a HighLevel connection is refused with
  *"Personal connections never enter Acme. Ask an admin to connect it for Acme."* A login from a sign-in card is saved by
  an Admin only, for the whole team.
- **Browsers.** Each private chat with a bot drives that person's own browser of the bot, each group chat the group
  chat's, and the bot's main chat the team's: separate Chrome profiles, saved sign-ins and live views, so a site one
  member signed in to in their chat never opens signed in for another member. The live view shows the browser of the
  conversation it is opened from, to whoever may read that conversation (an Admin reading a member's chat sees that
  member's browser there); with no conversation named (a phone) it is the person's own. Every Chrome runs in its own
  box (below).
- **Phones.** Settings → *Open on your phone* (and *Connect your phone* in the account menu) shows a code made for the
  person signed in. The phone app scans it as any `/pair#code=` link and gets that person's session: their address,
  their role, their chats, never another member's. The phone stays signed in while the person's app keeps checking in
  with the Admin (it does so while the team is open in it) and ends within the hour after the last check. Under the code,
  *Paired devices* lists the phones those codes opened as *device · member* (`GET /api/team/phones`): a member sees their
  own, the Super admin and Admins every member's. **Remove** (`DELETE /api/team/phones/<id>`, the same rule) signs that
  phone out at once and closes its open streams; the app windows the Admin signs in are not listed there.
- **Never asleep, kept across restarts.** A Team Cloud refuses the Admin's sleep request (`busy: ["team"]`) and keeps
  every member's session across a restart; a My Cloud revokes every session that is not its owner's at each boot.

## The role

`OMB_CLOUD_ROLE=team` with `OMB_CLOUD_TEAM_ID` (the Admin's id) and `OMB_CLOUD_TEAM_NAME` (1 to 80 characters), beside
the usual Cloud home contract (`OMB_CLOUD_MACHINE_ID`, `OMB_CLOUD_ADMIN_URL`, `OMB_CLOUD_BOOTSTRAP_SECRET`,
`OMB_PUBLIC_URL`). Everything else is a Cloud home: the signed routes (`/api/cloud/pairing`, `/api/cloud/health`,
`/api/cloud/power`, `/api/cloud/box`), the launcher, the box, the broker, `OMB_CLOUD_EXPORT_ONLY=1`.

What the role turns off: the personal settlement (`cloud-owner.ts`: no session is revoked at boot, no owner key, no
earlier-owner adoption), lending a Mac (nobody's Mac serves a team), the guest confinement of a My Cloud (a member's turn
runs at the bot's own level inside the box; only what came in from outside, a webhook, runs confined), and the "only the
owner" card rule (whoever started a conversation, or an Admin, answers its cards, as on a hosted workspace).

`OMB_CLOUD_TEAM_LANGUAGE` (optional, one of the app's locales: `de`, `pt-br`…) is the team's default language, set on
the Admin's Team admin → Settings. It is this server's language while its own settings set none (the app's words and the
language new bots start in); a value that isn't a locale is ignored, never refused.

## Team admin: the Admin's signed read

The Admin's Team admin pages (openmaus-cloud docs/team-cloud.md "Team admin") show a team's Super admin and Admins what
this server shares with every bot. It exists only on a Team Cloud.

- `GET /api/cloud/team/admin`, signed like `/api/cloud/health` → `{ v: 1, apps: { available, services: [{ slug, status,
  accounts: [{ id, alias, status }] }] }, mcp: [{ name, transport, host, enabled, signedIn, secrets }], keys: [{ id:
  "treg" | "voice", configured, included? }], ai: { keys: [{ id: "anthropic" | "openai" | "openrouter", configured }],
  engines: [{ id, name, authenticated, account: { email, organization, method } | null }] } }` (`cloud-team-admin.ts`).
  Names, states and the identities the providers report: never a key, a token, a header or environment value (`secrets`
  are their names), nor any part of an MCP address but its host.
- Changes are never signed calls of their own. The Admin pairs as the admin making the change (the usual signed pairing
  with their `member` claim: an `owner` or `admin` gets the admin scope) and uses that session with the routes the app
  uses: `PATCH /api/config` for a key, `/api/mcp/servers` to add, test, sign in to and remove a server,
  `/api/connectors/:slug/authorize` and `DELETE /api/connectors/:slug/accounts/:id` for apps. Every check, side effect
  and record is the app's own, and each change is that member's. A User's session is refused there as anywhere.
- A Team Cloud always keeps its admin activity (`/api/admin-activity`), even with no User signed in: it is shared by
  definition. The Admin's Team admin → Activity reads it with the same session, beside the team's own record there; Usage
  reads `/api/usage` (by person, bot and model) and `/api/usage/traces` (the runs) the same way.
- For a business sign-in (Claude or ChatGPT on this server), the Admin opens this server's own pages signed in as that
  admin (a browser sign-in with the member's claim) at `/?connect=ai` (or `apps`, `mcp`, `keys`).

## Connections: the team's or each person's

Every app (a Composio toolkit) and MCP server has a scope. `team`, the default and what every connection made before this
is, is one connection an Admin makes and every turn uses. `person` is one connection per member, made by that member on
their team page in MausBot Cloud (the Admin's Cloud page calls the routes below as them).

- **Who gets a member's own connection.** Only a turn in that member's private chat (`member:<person>`) that their own
  message started (the request proven for that turn, as lent computers use). Never a group chat, the bot's main chat,
  another member's chat, an Admin writing in theirs, a routine, a webhook, or work handed on from another conversation.
- **Apps.** A member's own apps are their own installation on the connected-apps service (their own Composio user),
  registered the first time they press Connect. Their turn gets a second bridge, `own_apps`, beside the team's
  `composio`; the relay checks every frame again: the team's bridge refuses a `person` app (and code that calls apps
  while the team's own installation still holds one), a member's bridge refuses a team app and anything outside their
  own turn. A connection card for a `person` app is never shown: the bot gets one plain line to say, *"Connect your
  Gmail here: <their team page>"*, or that it works only in each person's private chat.
- **MCP servers.** Only a server reached by its address can be `person`. A `person` server's team credential is never
  attached to any turn; a member's own turn gets the server with their own key (in the header the Admin's key used, else
  `Authorization: Bearer`) or their own sign-in. Both are pinned to the server's address: re-pointed, they aren't sent.
  Removing the server forgets every member's key and sign-in for it.
- **Storage.** `team-connection-scopes.json` (no secret, carried by backups) and `people-connections/` (0700; each
  member's installation token, keys and sign-ins, 0600), which no backup carries and no bot box binds. Nothing a route
  answers carries a key, a token or more of an address than its host.

| Route | Who | |
|---|---|---|
| `PUT /api/team/connection-scopes { kind: "app" \| "mcp", id, scope: "team" \| "person" }` | admin | `{ scopes: { apps, mcp } }`; recorded in admin activity |
| `GET /api/team/my-connections` | the member | `{ team, link, email, apps: [{ slug, name, connected, accounts }], mcp: [{ name, host, connected, how, offers }] }` |
| `POST /api/team/my-connections/apps/:slug/connect` | the member | `{ url }`, the app's own sign-in (a new tab) |
| `DELETE /api/team/my-connections/apps/:slug` | the member | |
| `POST /api/team/my-connections/mcp/:name/sign-in` | the member | `{ auth }`; it comes back to this server's `/mcp-oauth/callback` |
| `PUT /api/team/my-connections/mcp/:name/key { value }` | the member | write-only |
| `DELETE /api/team/my-connections/mcp/:name` | the member | |

The signed read (`GET /api/cloud/team/admin`) adds `scopes: { apps, mcp }` and `people: { apps: { <slug>: [address] },
mcp: { <name>: [address] } }`: who has connected each, never with what.

## The pairing claim (contract v1)

The Admin signs the usual pairing body with two more fields:

```json
{ "label": "OpenMausBot app (Team Cloud)", "ttlSeconds": 300,
  "team": { "id": "<team id>", "name": "Acme" },
  "member": { "email": "mira@example.com", "role": "owner" | "admin" | "member" } }
```

| Claim | What the machine does |
|---|---|
| `member.role` `owner` or `admin` | scopes `admin` + `client` |
| `member.role` `member` | scope `client` |
| `member.email` | the session's address; the person's key (`personKey`) is its hash, the same on every device |
| `team.id` (optional) | must be this machine's team: `team_mismatch` otherwise |
| no `member` | `member_required` (400); a bad address or role `invalid_member` |
| a bad signature | `invalid_signature` (401), and it counts toward the pairing lockout |
| any `team` or `member` claim on a My Cloud | `not_a_team` (400): a My Cloud is one person's |

The session carries `teamRole` and `membershipAuthority: "team"`: the sign-in list never revalidates or revokes it, and
`/api/auth/session` answers `team: { id, name, role }`.

**Membership lives on the Admin.** Nothing is pushed to the machine and no roster read exists, so the machine checks
membership the one way it can: at each pairing, which the Admin signs only for a current member. A team session
therefore ends within the hour of its pairing (`TEAM_SESSION_MAX_MS`), however much it is used, and the app pairs
again; a removed member's next pairing is refused by the Admin (404), so they are out within the hour. A session is also
kept only across a clean restart. A signed roster read on the Admin would make this immediate; until then this is the
truthful mechanism.

**A member's own code (their phone).** `POST /api/team/phone-pairing` (any team session, Member included) makes a pairing
code carrying the caller's `member` claim (address, role, the role's scopes) and the time the Admin last vouched for
them; on a Team Cloud `POST /api/auth/pairing` does the same for an admin session, so no team session makes a bare
code. The session it opens is a team session that ends within the hour of that check, not of the scan; each later
Admin-signed pairing of the same member in the same role moves it (`SessionRegistry.memberChecked`). A role change
leaves it to end; a removed member's phone signs out within the hour.

## The audience rule

Everything stored on a Team Cloud carries an audience (`server/audience.ts`):

| Audience | Who | What carries it |
|---|---|---|
| `team` | everyone who sees the bot | a bot's main chat, its own folder (`workspaces/<bot>`: MEMORY.md, memory/, skills), team files, routines nobody opened |
| `room:<id>` | whoever sees the room | the room's threads, `workspaces/<bot>--room-<id>` |
| `member:<person>` | that person and the Admins | the conversations they opened (`thread-starters.json`), `workspaces/<bot>--member-<person>`, their uploads, `people/<person>/about.json` |

**A turn reads only inputs whose audience includes everyone who will see its answer, and writes only into its own
audience.** `mayRead(input, turn)` is true for the team's things and for the turn's own audience, nothing else.

| Turn | Reads | Writes into |
|---|---|---|
| Mira's private chat with Scout | Scout's setup, the team's notes, Mira's layer, Mira's About you, Mira's conversations with Scout | Mira's layer (memory_update, the memory file, the turn's log line, captured facts; About-you facts to Mira's About you) |
| A room with Mira and Ben | Scout's setup, the team's notes, the room's layer and threads | the room's layer |
| Scout's main chat | the team's notes, the team's conversations | the team's notes |

Where it is applied: visibility (`VisibleSet.thread` with each conversation's audience; a member's bot list carries only
their conversations; search, SSE and attachments go through the same check), the memory system prompt
(the turn's layer, plus the team's notes read-only), recall (`buildRecall.memoryIds`: the layer and the team's), recent
work, `session_search` (memory of the layer and the team's; conversations the turn may read), memory writes
(`/api/internal/memory`, `/memory/log`, the turn-outcome line, capture), "About the user", and the bot box, which puts the
turn's layer folder back read-write for that conversation's boxes only (`botBox.lend`). Member layers are sibling
folders of the bot's own, never inside it, so no other turn of that bot can read them.

Browsers follow the same rule (`server/browser/audience.ts`). A non-team audience adds a fixed suffix to the browser's
name, `--member-<hash>` or `--room-<hash>` (16 hex characters of the person key's or the room id's SHA-256: agent-browser
refuses a socket path over 103 bytes), to the agent-browser session, its saved state, its profile folder, the new
engine's profile key (`bot:<bot>--member-…`, `shared:<profile>--member-…`) and a temporary browser. Which suffixes exist
is kept in `browser/audiences.json`, so deleting a bot or a shared profile erases every audience's browser, after a
restart too. The live view takes `?threadId=` (the desktop's panel sends it on a team), and so do the signed-in sites
routes.

**Each Chrome in a box.** On a Team Cloud with the bot box on, the Chrome launcher agent-browser runs starts every
Chrome inside bubblewrap (`net: "shared"`, as the browser's own gate filters its traffic): the system read-only, private
`/tmp` (its HOME), the seccomp filter, and of the disk only the profile it was started on (`--user-data-dir`). A file a
turn uploads is linked into that profile's `omb-uploads/` first. The agent-browser daemon itself stays outside: it
holds the session's saved-state key and talks to the server's runtime by its own socket and pid files.

On a My Cloud and on a desktop there is one person: every audience is the team's, every layer is the bot's own folder,
every browser keeps its old name and Chrome its old launcher, and nothing here changes what those do.

## What is not closed here

- **Saved logins per member.** A login saved from a sign-in card is the team's (an Admin saves it, for every bot in the
  team); per-member saved logins are not built. Sign-ins a member makes in their own browser stay in it (above).
- **The new browser engine and temporary browsers in a box.** The new engine (`browserEngine.engine: "chrome"`, off by
  default) starts Chrome itself over a pipe and is not boxed; a temporary browser is boxed, but a file a turn uploads
  into it is not reachable from its box.
- **Per-member engine state.** A Team Cloud's engines use the team's key through the broker, so the engine's config dir
  (`~/.claude`, `~/.codex`) holds no member's login; it is the team's, by design.
- **A roster read from the Admin.** Removal takes effect within the hour (above), not at once.
- **A removed member's own connections.** They stay on the Team Cloud, unused (nobody can start a turn as them), until
  the server they were for is removed. Nothing drops them when the Admin removes the person yet.
- **Own apps with the team's own Composio project.** A member's own apps always use OpenMausBot's connected-apps
  service, even when the team connected a Composio project key of its own; an app that needs the project's own auth
  config can't be connected by each person.
