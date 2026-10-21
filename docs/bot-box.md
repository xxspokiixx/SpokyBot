# The bot box

On a MausBot Cloud home every bot turn runs in a box: the engine (Claude Code, Codex, Grok, OpenCode, the ACP agents),
every shell command it runs, the MCP servers it starts and OpenMausBot's own helper proxies all live inside one
unprivileged [bubblewrap](https://github.com/containers/bubblewrap) sandbox for that process's lifetime. The server,
its database, its settings, other bots' folders and other turns' processes are not in it. Code: `server/bot-box/`.

## What a boxed process sees

| Inside the box | What it is |
|---|---|
| `/usr`, `/etc`, `/opt`, the server's own code folder, read-only | The image: engine CLIs, node, python, git, the bots' browser |
| `HOME`, read-write | The engines' own logins and settings (`~/.claude`, `~/.codex`, `~/.grok`) |
| the data folder (`~/.openmausbot`), **an empty private folder** | `messages.db`, `config.json`, logins, the server's sockets, every other bot's folders are not there |
| put back inside it: the turn's working folder and the bot's own folder (`workspaces/<bot>`), read-write | What the turn works on, and the bot's memory and skills |
| put back: this turn's permission socket and the files its command line names (MCP config, system prompt), read-only | What the driver made for this one process |
| private `/tmp`, `/var/tmp`, `/run`, `/dev`, `/proc` | Its own PID namespace: other turns' processes do not exist for it |
| a network namespace with loopback only | Two loopback ports are bridged to unix sockets from outside (below); nothing else on the machine's loopback is reachable, and there is no route out |

The environment is an allow-list (`server/bot-box/env.ts`): the engine's own settings and keys, the harness capability
tokens and a few names a shell expects. Every `OMB_CLOUD_*` setting, the server's own placement (`OMB_DATA_DIR`,
`OMB_PORT`) and the workspace credentials are refused whatever a driver passed.

## The two gates

- **Egress** (`server/bot-box/egress-gate.ts`): an HTTP proxy (`CONNECT`, and absolute URLs for plain http) at
  `127.0.0.1:3128` inside the box, bridged to the server's gate. `HTTPS_PROXY` and `HTTP_PROXY` point there. The gate
  resolves names itself and connects only to public addresses: this machine, the local network, link-local, the cloud
  metadata service and Fly's private network are refused by address, so neither a name nor a redirect gets around it.
  It is the engines' twin of the browser's SOCKS gate (`server/browser/egress/`), with the same address policy.
- **Harness** (`server/bot-box/harness-gate.ts`): the server's own port inside the box reaches only `/api/internal/`
  routes, which every helper calls with a per-turn capability bearer. Every other route is answered `403` by the gate
  itself, so the server is never asked.

A box with the host's network (`net: "shared"`, for a browser whose Chrome already goes through its own gate) has
neither bridge.

## When it is on

`server/bot-box/detect.ts`: on by default on a Cloud home (`OMB_CLOUD_ROLE=home` or `team`), off everywhere else
unless `OMB_BOT_BOX=1`; `OMB_BOT_BOX=0` turns it off. It is never on without a working unprivileged bubblewrap: if the
kernel refuses user namespaces or the image has no `bwrap`, the box reports `off` with the reason, and the Admin shows
it. The cloud-home image installs `bubblewrap` and `socat` (the in-box bridges; without socat a bundled Node bridge does
the same).

Cost on Fly (measured, T0 build notes): about 5 ms and 3 MB per box, plus one socat per bridge.

## The self-check and the report

At boot, and by hand with `node dist-server/bot-box/box-check.js`, the server runs `box-probe.ts` inside a real box
over a fixture laid out like a data folder, with a canary process and a fixture server, and counts what a hostile bot
could and could not do (`server/bot-box/self-check.ts`). The Admin reads the result in the signed health report and at
`GET /api/cloud/box`: `{ box: "bwrap" | "off", checks: "23/23", failed: [], boxed, refused }`. Running the check with a
mutation (`--mutate=bind-data,share-pid,share-net,env-all,tmp-shared`) removes one protection and must fail exactly the
checks it guards.

## What it does not do yet

- The engines' subscription logins (`~/.claude`, `~/.codex`) are in the box, because the engine needs them. API keys
  stay in the environment until the credential broker (T0b) replaces them with per-turn tokens.
- The box runs as the server's own user inside a user namespace; a separate Linux user per bot needs a privileged
  spawn service (T0c notes).
- The bots' browser engine (agent-browser) is not boxed yet; its Chrome goes through its own gate.
