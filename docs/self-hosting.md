# Self-hosting the OpenMausBot server

Run the harness server on an always-on Linux box (a VPS, a home server, a
Mac mini in a closet) and use it from other devices. This is the supported
path **today**; first-class remote access is coming — see
[`docs/plans/remote-workspace.md`](plans/remote-workspace.md).

> **Security first:** the server deliberately trusts only loopback — any
> process that can reach `127.0.0.1:8799` has full control, including the
> shell your bots can use. **Never reverse-proxy it to the public internet
> and never bind it to a public interface.** Reach it through an SSH tunnel
> (below) or a private network you trust. Proper token-based remote auth is
> exactly what the Remote Workspace plan adds.

## What works headless (and what doesn't)

Runs fully on a server:

- every engine CLI (Claude, Codex, Grok, custom ACP engines — install and
  log them in **on the server**)
- chats, rooms, bot-to-bot coordination, routines (they keep running with
  every laptop on the planet closed — this is the point)
- connected apps / custom MCP servers, webhooks, Company Brain
- computer use on **cloud or container computers** (the bot's computer runs
  server-side anyway)
- text-to-speech (with a key), the web UI (the server serves it itself)

Desktop-only for now (needs the Mac/Linux app):

- the built-in browser panel, the skill recorder, dictation/voice,
  controlling the host desktop

## Setup

Requirements: Node 24+, pnpm, and at least one agent CLI installed and
signed in on the server.

```sh
git clone https://github.com/milind-soni/OpenMausBot && cd OpenMausBot
pnpm install

# choose where data lives and start the server
OMB_DATA_DIR="$HOME/.openmausbot" OMB_PORT=8799 \
  node --experimental-strip-types server/index.ts
```

For something durable, run it under systemd:

```ini
# /etc/systemd/system/openmausbot.service
[Unit]
Description=OpenMausBot harness
After=network.target

[Service]
User=maus
WorkingDirectory=/home/maus/OpenMausBot
Environment=OMB_DATA_DIR=/home/maus/.openmausbot
Environment=OMB_PORT=8799
ExecStart=/usr/bin/node --experimental-strip-types server/index.ts
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Engine CLIs read their logins from the service user's home — sign in as
that user (`sudo -u maus claude` etc.) before starting the service.

## Using it from your computer

Open an SSH tunnel and use the web UI in any browser:

```sh
ssh -L 8799:localhost:8799 you@your-server
# then open http://localhost:8799
```

The server serves the full app UI itself — no desktop install needed on the
client. The tunnel keeps the loopback trust model intact: to the server,
you look local, because through the tunnel you are.

Note: plain `tailscale serve`/reverse proxies will currently be refused —
the server checks that requests look like loopback on purpose. Use the SSH
tunnel until Remote Workspace lands.

## Using it from your phone

The iOS companion pairs with a running server. Start the companion process
next to the harness and pair by QR:

```sh
node --experimental-strip-types companion/src/index.ts
```

It advertises on your private networks (Tailscale-aware) and issues
per-device credentials on pairing — see the pairing screen in the iOS app.

## Updating

```sh
git pull && pnpm install && sudo systemctl restart openmausbot
```

Routines and queued work survive restarts; in-flight turns do not, so
update between runs.
