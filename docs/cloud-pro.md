# OMB Cloud Pro: the home machine

Cloud Pro gives one person an always-on OpenMausBot server of their own. Each
customer gets one Fly app with one `home` machine that is always on, a volume
at `/data`, and TLS at `https://<app>.fly.dev`. The desktop app, the phone and
the web are windows onto it. Local use of the app is unchanged and free.

Cloud Pro includes no AI usage. The person signs in on their machine with their
own Claude or ChatGPT subscription, or an API key, through the same sign-in
flows as any OpenMausBot server. Nothing on a Cloud home is routed to a
platform model gateway.

This page is the OpenMausBot half of a contract with three parties:

- **the home machine**: this repository's `deploy/fly/` image;
- **the Admin** (openmaus-cloud, `docs/consumer-cloud.md` there): provisions
  the app, holds the machine's signing secret, and answers the desktop's Cloud
  session;
- **the desktop app**: signs in to Cloud, lists the machine under Servers,
  and offers **Connect to my Cloud**.

Contract version: `1` (`cloudContractVersion` on the wire).

## What the person sees

1. They subscribe on the Cloud site. The Admin creates the Fly app and machine.
2. They open the desktop app, go to **Settings → OMB Cloud** and sign in (the
   existing device sign-in). A **Your Cloud** card says **Setting up** until
   the machine is up.
3. When it is ready, the machine appears under **Servers** as **My Cloud**, and
   the card offers **Connect to my Cloud**. One click opens the machine in the
   app window, signed in. There is no second confirmation.
4. The first thing the Cloud shows is its engine sign-in
   (`src/components/CloudEngineSignIn.tsx`), with three choices:
   - **Sign in to Claude**: the existing paste-code flow (open Anthropic's
     page, paste the code back);
   - **Sign in to ChatGPT (Codex)**: the existing device-code flow;
   - **Use an API key**: the existing model-provider keys in **Settings →
     Connections** (Anthropic, or an OpenAI-compatible key such as OpenRouter).

   It says plainly that the account's plan limits apply to bots running 24/7,
   and that a Claude Max plan or an API key is recommended for heavy use.
5. Until one of those engines can run, every bot on the Cloud, including the
   default one, shows this sign-in rather than a chat that fails its first
   turn. Once one can run, the chat takes its place. Sign-ins stay on the
   machine's volume (`~/.claude`, `~/.codex`, the server's own config).

The Cloud's `GET /api/auth/session` answers `"cloudHome": true` for a paired
session; that is how the web UI knows to open the engine sign-in instead of
the welcome flow, which describes the person's own computer (it can still be
replayed from Settings). A paired session without admin scope (a phone paired
as a client) is not shown the sign-in, since it cannot sign engines in.

The card shows one of: **Setting up**, **Ready**, **Stopped**, **Payment
problem**, **Could not be set up yet**. Only Ready can be connected to.
Signed out of Cloud, the app makes no Cloud request and nothing on this page
runs.

### Open in the app: `openmausbot://cloud`

The Cloud page (`https://cloud.openmausbot.com/cloud`) can offer **Open in the
app** as a link to exactly `openmausbot://cloud`. The app accepts that string
and nothing else: no path, query, fragment or trailing slash, and it ignores
any other form. Like `openmausbot://organization`, it is an action, not a
router. It never carries an address, a pairing code or a credential; the app
decides everything from its own verified state (`electron/cloud-entry.mjs`).

1. The link starts the app, or brings it forward if it is already running
   (launch argument, a second instance, or macOS `open-url`, including one
   that arrives before the app is ready). If the window already shows
   **My Cloud**, coming forward is all it does.
2. Otherwise the window returns to this computer (a hosted server that was
   showing stays saved under **Servers**) and opens **Settings → OMB Cloud**.
   Before that view acts, the app gives a saved Cloud sign-in up to five
   seconds to finish restoring, so it is never mistaken for signed out.
3. Opened this way, the view acts on its own, with no confirmation:
   - signed out: it starts the existing device sign-in at once, which opens
     the browser approval page with the code filled in
     (`/cloud/desktop?code=…`);
   - signed in and the Cloud is **Ready**: it connects to **My Cloud**,
     exactly like **Connect to my Cloud**;
   - after that sign-in completes, or when the Cloud becomes **Ready** while
     the view is still open, it connects then;
   - anything else: the card shows the status and the person decides.

It starts at most one sign-in (only when signed out on arrival; a later
sign-out in that view starts nothing) and one automatic connection per link.
A failed connection shows the card's error; clicking the link again retries.
Closing Settings or choosing another section ends it. While it is open, the
first-run welcome waits, as it does for Organization settings. A normal visit
to **Settings → OMB Cloud** never signs in or connects by itself.

The link does nothing in development builds, and in companion client mode it
explains that the app must be disconnected from the other computer first.
The `openmausbot` scheme belongs to the installed app: on macOS through the
app bundle, on Linux through the `.deb`'s desktop entry, and on Windows (and
for an AppImage) once the installed app has started at least once, since it
registers itself at startup. Before that, or if the app is not installed, the
browser has nothing to open (it shows nothing or an error), so the Cloud page
should keep a download link next to the button.

## The image

`deploy/fly/Dockerfile` builds on the published server image
(`ghcr.io/milind-soni/openmausbot`) and adds:

- the engine CLIs from `ENGINES` (default Claude Code and Codex; the base
  image already carries agent-browser and its Chrome);
- Caddy, as the only listener the network can reach (`0.0.0.0:8080`);
- `server/cloud-home-start.ts` (bundled to `dist-server/cloud-home-start.js`)
  as the entry point.

```sh
docker build -t openmausbot .
docker build -f deploy/fly/Dockerfile --build-arg BASE_IMAGE=openmausbot -t omb-cloud-home .
```

At boot the launcher, running as root only for this step, hands the volume's
mount point to the `maus` user, drops privileges for good, binds the volume to
this machine (`/data/.omb-cloud-home.json`; another machine's volume, or an
unmarked volume with data on it, is refused), and runs two children: the
server on `127.0.0.1:8799` (webhooks on `127.0.0.1:8800`) and Caddy on
`:8080`. If either exits, both stop and Fly restarts the machine. The one
exception: after a restore commits (Move to Cloud, below), the server exits
with code 75 and the launcher starts only the server again.

`HOME=/data`, so `~/.claude`, `~/.codex` and OpenMausBot's own data
(`/data/.openmausbot`) persist on the volume.

### Why the server stays on loopback

`server/request-auth.ts` treats an unproxied loopback request as the
machine's owner. The server therefore never binds a public interface. Caddy
(`deploy/fly/Caddyfile`) forwards every request with `X-Forwarded-Proto:
https` and `X-Forwarded-For`, so the server sees each one as remote: it needs
a paired session, whatever `Host` it claims. Caddy trusts `Fly-Client-IP`
only from Fly's private ranges; that address feeds the pairing lockout, never
authorization. Apart from `/api/health`, Caddy answers only for the machine's
own name (`OMB_PUBLIC_URL`) and refuses any other `Host`.

### Fly

The Admin creates the machine through the Machines API; `deploy/fly/fly.toml`
is the same shape for a manual deploy: `internal_port = 8080`, `force_https`,
no auto-stop, one machine always running, a volume `omb_home` at `/data`,
restart policy `always`, and an HTTP check on `GET /api/health` (it answers
`{"app":"openmausbot"}` with no session). Each customer's app lives in its
own Fly private network, so no machine can reach another's over 6PN.

## Boot contract

Set by openmaus-cloud's provisioner (`server/cloud-machines.ts`). Any of the
first four switches the server into Cloud home mode; then all of them are
required and the whole contract is validated. A partial or invalid contract
stops the server before it serves, with a message that names the variable and
never echoes a secret.

| Variable | Fly | Value |
| --- | --- | --- |
| `OMB_CLOUD_ROLE` | env | `home`. (`desktop` belongs to the Cloud desktop image and is refused here.) |
| `OMB_CLOUD_MACHINE_ID` | env | The Admin's machine id (a UUID). Binds the volume. |
| `OMB_CLOUD_ADMIN_URL` | secret | The Cloud origin, exact `https://`, e.g. `https://cloud.openmausbot.com`. |
| `OMB_CLOUD_BOOTSTRAP_SECRET` | secret | 43 base64url characters (256 bits): the key the Admin signs pairing requests with. |
| `OMB_PUBLIC_URL` | env | The machine's exact `https://` origin, `https://<app>.fly.dev`. |

- The machine must not also carry `OMB_ADMIN_URL`, `OMB_ADMIN_WORKSPACE` or
  `OMB_ADMIN_MEMBERSHIP`: a Cloud home is a personal server with pairing codes
  on, not a hosted team workspace with portal membership.
- `HOME=/data` and `OMB_DATA_DIR=/data/.openmausbot` are set by the image.
- The server keeps the secret in memory and removes it from its environment at
  startup; no engine or tool it starts ever inherits it.

### No model gateway

Cloud Pro includes no AI, so the contract has no model gateway. If a Cloud
home is ever given `OMB_HOSTED_MODEL_URL`, `OMB_HOSTED_MODEL_TOKEN` or
`OMB_HOSTED_MODELS` (an Admin from before this decision set all three), it
still boots, logs one warning naming the variables (never their values), and
ignores them:

- the launcher drops them from the server's environment, and the server drops
  them from its own at startup, so no engine or tool ever sees them;
- the portal workspace model policy (`server/hosted-models.ts`) stays off on a
  Cloud home whatever they hold, so no instance is routed to a gateway;
- no `included.*` or other read-only instance is served; the person's own
  engines are the only way to a model.

### Included Boat computers and voice

Pro includes Boat cloud computers and ElevenLabs voice with no key to paste.
When the Admin has both services configured, it also sets:

| Variable | Fly | Value |
| --- | --- | --- |
| `OMB_CLOUD_BOAT_URL` | env | `https://cloud.openmausbot.com/api/cloud/services/boat/api/box/v1`, the Admin's Boat relay. It keeps Boat's own `/api/box/v1` ending, so the Computer engine's model catalog (`<root>/api/provider-models`) resolves through the relay too. |
| `OMB_CLOUD_BOAT_TOKEN` | secret | This machine's Boat relay token (`box_omb_…`). It is not a Boat key and works only through the relay. |
| `OMB_CLOUD_VOICE_URL` | env | `https://cloud.openmausbot.com/api/cloud/services/voice/v1`, the Admin's voice relay. |
| `OMB_CLOUD_VOICE_TOKEN` | secret | This machine's voice relay token (`omb_voice_…`). |
| `OMB_TTS_DEFAULT_VOICE` | env | An ElevenLabs voice id, used until the person picks a voice or another speech provider in Settings. |

A service is included only when both its URL and its token are set
(`server/included-services.ts`). The real Boat and ElevenLabs keys stay on the
Admin, which checks the subscription, the monthly caps and which computers
belong to this machine on every request.

- **The person's own key always wins.** An included token is a fallback, used
  only while the person has no key of their own: none saved in Settings
  (`box.token`, `tts.key`) and no `BOX_TOKEN` or `OMB_TTS_KEY` in the
  environment. Adding a key switches to it at once; removing it falls back to
  the included service again (for Boat, once that key's cloud computers are
  deleted: removing a Boat key that still has computers is refused). The
  choice is made on every request.
- **Each credential goes to one place.** The relays know only the Admin's
  accounts, so an own key goes only to the provider (`OMB_BOX_API` or
  `OMB_ELEVENLABS_API` when set, for development and tests, else Boat's and
  ElevenLabs' own APIs) and an included token only to its relay.
- **An included token is never the person's key.** It is never written to
  `config.json`, never sent to a client (Settings sees `configured` and
  `included: true`, and says "Included with Cloud Pro"), and Settings never
  verifies, rotates or clears it. Boat's account-change rules still apply:
  adding an own Boat key while included cloud computers exist is refused until
  they are deleted, because the new account cannot reach them.
- **What holding the tokens does and does not do.** The server reads both
  tokens at startup, keeps them in memory and removes them from its
  environment, like the bootstrap secret, and they are on the credential list.
  So no process the server starts inherits them, including tools that copy
  its environment as it is (the browser, docker, ssh, MCP bridges). It does
  not make them unreadable: the launcher starts the server with them, so the
  server's `/proc/<pid>/environ` keeps its startup environment, and an engine
  running as the same user (a bot with a shell) can read a relay token there.
  That is accepted because a relay token is only this customer's own Cloud Pro
  allowance: it works only through the Admin, only on this machine's cloud
  computers and voice, and only up to the monthly caps. Whoever holds it can
  at worst use up this month's included hours or voice characters; it opens
  no other customer's data and none of the Admin's provider keys.
- A refusal from the relay (for example, the month's cloud computer hours are
  used up) is shown as the relay's own message. A resume that fails with a
  server error is retried on the next poll, as Boat asks.

## Pairing: the Admin's signed request

`POST https://<app>.fly.dev/api/cloud/pairing`

```http
POST /api/cloud/pairing
Content-Type: application/json
x-omb-cloud-timestamp: 1790000000
x-omb-cloud-nonce: <base64url, 16–128 characters>
x-omb-cloud-signature: v1=<base64url HMAC-SHA256(OMB_CLOUD_BOOTSTRAP_SECRET, canonical)>

{"label":"OpenMausBot app (Cloud)","ttlSeconds":300}
```

where `canonical` is

```text
v1\n<timestamp>\n<nonce>\nPOST\n/api/cloud/pairing\n<base64url SHA-256 of the raw body>
```

`200`:

```json
{ "code": "ABCD-EFGH-JKLM", "credential": "omb_pair_…", "expiresAt": 1790000300000 }
```

`code` and `credential` are two encodings of **one ordinary pairing window**
(`server/sessions.ts`): single use, admin and client scopes, redeemed at the
machine's existing `POST /api/auth/pair`.

| Status | Body | Meaning |
| --- | --- | --- |
| `401` | `{"error":"invalid_signature"}` | Wrong key, tampered request, or malformed headers. Counts toward the per-source pairing lockout. |
| `401` | `{"error":"stale_request"}` | Timestamp more than 300 s from the machine's clock. |
| `401` | `{"error":"replayed_request"}` | Nonce already used in the last 10 minutes. |
| `429` | `{"error":"rate_limited","retryAfterSeconds":n}` | Too many bad signatures from this source. |
| `400` | `invalid_body`, `invalid_label`, `invalid_ttl` | Not a JSON object; label not plain text of 80 characters or fewer; TTL not a positive integer. |
| `405`, `415` | | Not a POST; not JSON. |

Rules the machine enforces: the signature is checked first, in constant time;
the timestamp within ±300 s; each nonce refused for 10 minutes; `ttlSeconds`
defaults to 300 and is capped at 600; nothing about the request (headers, body
or code) is logged. Nonces live in memory, so a restart forgets them; a
captured request is still bounded by its five-minute timestamp window and TLS.

## What the desktop reads from the Admin

The desktop polls `GET /api/cloud/desktop/session` with its personal device
token (`Authorization: Bearer omc_…`). Contract version 1 adds:

```json
"cloud": { "state": "ready", "origin": "https://omb-u-1a2b3c4d5e6f.fly.dev", "pairingAvailable": true }
```

- `null` or absent when the account has no machine; the app then shows nothing new.
- `state` is `setting_up`, `ready`, `stopped`, `payment_problem` or `failed`.
  `origin` is required for `ready`. Any other state (including the retired
  `allowance_used`) is treated as no machine. Other fields, such as a retired
  `allowance`, are ignored.

**Connect to my Cloud** first asks the machine whether this app is already
signed in there (`GET <origin>/api/auth/session` with its cookie). If not, it
calls `POST /api/cloud/desktop/pairing` (same device token) and expects
`{"cloudContractVersion":1,"origin":…,"code":…,"expiresAt":…}` for the same
origin, with `expiresAt` at most ten minutes away. It then adds or selects the
**My Cloud** server entry and opens `<origin>/pair#code=<code>`, the same
pairing-link flow as Connect to a server. The code stays in main-process
memory for that one navigation: never on disk, never in a renderer. A
malformed session summary or grant is treated as none.

## Move to Cloud

One action copies everything from the person's own computer to their Cloud:
bots, chats and their messages, attachments, memory, routines, skills, rooms
and teams, and the settings a workspace backup carries. It is a copy; nothing
on the computer changes. Chat history travels between machines here, and only
here, because the person asked for it. Secrets never travel.

### Where it is

- **Settings → OMB Cloud**, under Your Cloud once it is Ready: **Move to
  Cloud** (`src/components/CloudMove.tsx`). Before anything starts it shows the
  size and the counts (`GET /api/cloud-move/estimate` on the computer's own
  server), and says that API keys and sign-ins stay on the computer and that
  the person signs in to Claude or ChatGPT on the Cloud (the Cloud's first-run
  engine sign-in above).
- When the Cloud already has bots or chats, the button reads **Replace my
  Cloud with this computer's workspace**, and the card says that what the
  Cloud holds is replaced, backed up first, and put back by **Restore previous
  Cloud**. There is no confirmation dialog. Without a session on the Cloud yet
  (never connected), it says the same thing conditionally.
- The first time the app shows an empty Cloud (its starter bot at most, no
  rooms, nobody has chatted) and the computer has work of its own, the Cloud's
  page shows a card: **Bring your bots and chats from this Mac** ("this
  computer" elsewhere), with **Move** and **Not now**. Not now hides it for that
  Cloud for good; it never blocks anything. Only the desktop app shows it, and
  main answers the Cloud page only when it is the verified Cloud (the origin the
  Cloud session reports) open as the window's active server. That page can
  start a move only from the person's own click (`navigator.userActivation`)
  and cannot restore the previous Cloud.

### What moves, and what stays

Exactly what a workspace backup carries (`server/workspace-backup.ts`,
`server/workspace-backup-policy.ts`). Never: API keys, provider and MCP
connections, engine sign-ins (`~/.claude`, `~/.codex`, the server's
`providers/`), saved credentials, pairing, paired devices and sessions (the
session registry's open marker included), the server's identity, caches,
downloaded tools and runtime files. Never this app's Cloud sign-in or the
computers it lends: both live in the desktop app's own storage, not in the
workspace. Unsent drafts and window preferences stay on the computer.

The Cloud keeps its own: every connection section of its config (engine and
API keys, the included Boat and voice relays, sign-in allow-lists), its
sessions and pairing, its engine sign-ins, its computer-sharing switch
(`features.sharedComputers` always stays with the machine a backup is restored
on), and its boot contract (the environment, and the volume marker outside the
data folder). As with any restore, routines, webhooks and scheduled calls
arrive paused and nothing queued runs; the person turns routines on in the
Cloud when they want them to run there instead. A bot that used an engine or
API key the Cloud does not have asks for one there, and a bot pointed at a
project folder outside the workspace keeps that path, which the Cloud does not
have: the files inside the workspace move, folders elsewhere on the computer
do not.

### How it moves (`electron/cloud-move.mjs`, `server/cloud-move-http.ts`)

1. Main opens a session of its own on the Cloud. The Admin opens a single-use
   pairing window for the signed-in owner (`POST /api/cloud/desktop/pairing`),
   and main redeems it at `/api/auth/pair` for a bearer token held only in
   memory. That session is labelled "Move to Cloud" and signed out when the
   move ends.
2. The computer's server exports its encrypted backup with a random password,
   under the usual rule that bots finish their turns first, and main copies it
   to a private temporary file, hashing it.
3. `POST /api/cloud-move/upload {sha256, bytes, files}`. The Cloud refuses more
   than 10 GB of data or 100,000 files (`413`), and checks its free space: the
   upload three times over (the upload, its decrypted copy and its staged
   files), plus twice its own workspace when it will back that up, plus 256 MB.
   Cloud volumes have a fixed size (the Admin's `OMB_CLOUD_VOLUME_GB`, 10 by
   default). Not enough room is `507` with `freeBytes` and `neededBytes`, and
   the app shows both. Nothing has been moved at that point.
4. Parts of 16 MB (at most 64): `PUT /api/cloud-move/upload/<sha256>?offset=n`.
   A part already stored is accepted again without being written; any other
   offset answers `409` with `received`; a part that fails is cut back off.
   Main retries with backoff and continues from where the Cloud stands. An
   upload that keeps failing keeps its archive for 30 minutes, so moving again
   continues it rather than starting over.
5. `POST /api/cloud-move/preview {sha256, password}`: the Cloud checks the
   SHA-256 and stages the file as an ordinary backup, which authenticates the
   whole file before parsing anything. Anything that is not a valid backup is
   refused and the upload discarded.
6. `POST /api/cloud-move/restore {id}`, inside the maintenance gate: a Cloud
   with work is backed up first (below), then the restore is committed and the
   server exits with code 75. The launcher (`server/cloud-home-start.ts`)
   starts only the server again, and startup installs the restore before
   anything else loads. Preview, restore and undo can take minutes, so each
   answers `202` and runs as a job the app follows in `GET /api/cloud-move`.
7. Main waits until the Cloud reports that restore installed
   (`lastRestoreId`), signs its session out, and opens My Cloud in the window.

### Restore previous Cloud

Before a Cloud with work is replaced, its workspace is backed up to
`.backups/cloud-previous` on its own volume, which no backup includes and no
restore replaces. Its random password is kept beside it: the same volume holds
the same data unencrypted anyway. **Restore previous Cloud**
(`POST /api/cloud-move/undo`) restores it the same way, and it is offered
until that restore is installed. The archive stays until the next move
replaces it. Every restore also keeps its usual safety copy of the replaced
files (`.backups/safety-<id>`).

### Move security

- Every Cloud route needs a paired session with admin scope: never the
  machine's loopback (a bot's shell there) and never a client-scope device. Only
  a Cloud home receives a workspace; any other server answers `404`, except
  for sizing its own (`/api/cloud-move/estimate`).
- The upload is bounded by its declared size, the per-part limit and the
  backup's own limits on size and file count.
- The bundle is the workspace backup: credentials are left out by path and by
  a config allowlist, and checked again at staging (a config with connection
  settings or webhook secrets is refused). `server/cloud-move.e2e.test.ts`
  gives the desktop keys, a driver environment, workspace credentials and a
  provider login, moves it to a real Cloud home, and scans every file on the
  Cloud's volume, the staged bundle included, for them.
- Nothing logs a request body, the password, a file name or bundle contents.

## Security summary

- The server never listens on the network; only Caddy does, and nothing it
  forwards is the loopback owner.
- Pairing windows are opened only for a request signed with the machine's
  secret, fresh and never replayed; each window is single use and short lived.
- The signing secret is removed from the server's environment at startup and
  is never passed to engines or to Caddy.
- There is no platform model gateway: stray `OMB_HOSTED_*` settings are
  ignored with one warning and never reach the server's environment or an
  engine. Every model call uses the person's own sign-in or key.
- A volume binds to one machine and is never adopted by another.
- Each customer's app lives in its own Fly private network.

## Published image

Every push to `main` and every release tag publishes the home machine image as
`ghcr.io/milind-soni/openmausbot-cloud-home`, tagged `latest` (main only), `sha-<commit>` and the release tag.
It is built from `deploy/fly/Dockerfile` on top of the server image for the same commit, with Claude Code and
Codex installed. The Docker workflow's summary prints the digest. Set it in the Admin as
`OMB_CLOUD_HOME_IMAGE=ghcr.io/milind-soni/openmausbot-cloud-home@sha256:…`; changing it rolls the new image
out to existing machines one at a time, reverting automatically on a failed health check.
