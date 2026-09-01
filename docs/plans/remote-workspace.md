# Plan: Remote Workspace

Run the OpenMausBot server anywhere; connect from the desktop app, any
browser, or the phone — with real authentication instead of the loopback
trust model.

## Why

Three independent demand signals in one week: community members already
self-hosting on VPSes and asking how to connect from their Mac; users
wanting "the chat window from any PC or mobile" because a Linux server
outruns their laptop; and the standing product promise that routines keep
working with the laptop closed. The workload benefits are real: server
hardware is faster, always on, and every engine CLI runs happily headless.

## Design in one paragraph

The app learns **environments**: a saved list of workspaces (Local is just
the default), each with a name, URL, and session. Adding one uses
**one-time pairing** — the server mints a short-lived token shown as a QR
or pairing URL; the client exchanges it once for a durable per-device
session credential (hashed at rest). This generalizes the exact mechanism
the iOS companion already uses, to every client. The server's own served
web UI becomes the "any PC" client behind the same session — no separate
web app to build.

## Transports

1. **Managed tunnel (the default "just works" path):** the production
   cloudflared managed-tunnel channel the companion already uses — remote
   access with zero network configuration.
2. **Explicit URL** for self-hosters: SSH tunnel or private networks
   (Tailscale et al.), documented in `docs/self-hosting.md`.

## Auth phases

- **Spike (first):** verify whether the companion sidecar's authenticated
  proxy covers the full API + SSE surface. If yes, desktop/browser remote
  v1 rides the companion channel with near-zero harness changes.
- **Phase 1:** a single `OMB_ACCESS_TOKEN` session path in the harness for
  authenticated non-loopback clients, TLS terminated by a fronting proxy.
- **Phase 2 (enterprise track):** multi-user sessions, `users` + ownership
  + ACLs — extends the same seam; see the enterprise plan.

## Capability matrix (v1, stated honestly in the UI)

| Capability | Remote |
|---|---|
| Chats, rooms, coordination, routines, webhooks | ✅ full |
| Engines (all CLIs, custom ACP, OpenAI-compat) | ✅ run on the server |
| Connected apps / custom MCP | ✅ |
| Computer use (cloud/container) | ✅ server-side already |
| Web UI from any browser | ✅ served by the server |
| Built-in browser panel | ❌ local-only for now |
| Skill recorder, dictation, host-desktop control | ❌ local-only |

Version skew between client and server gets a visible warning with the
update path — cheap to build, prevents a whole class of confusing reports.

## Non-goals (v1)

- Desktop-managed SSH launch of remote servers (the VPS/docker path covers
  it without inheriting a shell-environment support burden).
- Auto-detected endpoint pickers (LAN/tailnet lists) — explicit URL and the
  managed tunnel first; polish later.
- Public-internet exposure without the tunnel or a fronting auth proxy.

## Sequencing

1. `docs/self-hosting.md` (shipped with this plan) — blesses today's path.
2. The companion-proxy spike (a day).
3. Environments UI + pairing + chosen transport (~1–2 weeks).
4. Enterprise multi-user sessions extend the seam (separate track).
