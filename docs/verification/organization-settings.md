# Optional desktop organisation connection

Run the actual renderer and production desktop preload/client in a disposable
Electron window:

```sh
node scripts/verify-organization-settings.mjs
```

The script accepts no external URL. It creates its own loopback Vite preview,
fake-engine workspace, synthetic Admin HTTP server, temporary HOME and Electron
profile. Renderer requests outside the preview and fixture runtime are blocked.
It never opens the user's app, browser profile, saved connections or keychain.
Linux needs a graphical session (or `xvfb-run -a`).

The smoke checks:

- The optional organization logo and shared bot-icon grid arrive in the
  authenticated native snapshot. Selecting an icon uploads a durable local
  attachment through the real fixture runtime. Admin removal clears the logo
  and library after Refresh without changing the bot's chosen local avatar.
  Branding is excluded from the strict runtime model grant and credential store.

- Loading Settings does not enroll or open a browser. **Sign in with your
  organisation** uses the standard OpenMaus Admin; a separate custom Admin
  address remains available under **Advanced**.
- The production client opens the browser and connects automatically after
  approval. The optional verification code stays collapsed under **Security
  details**, and cancelling returns to the signed-out view.
- Synthetic browser approval yields the company name, employee email and
  approved model counts. No device token or private connection method reaches
  renderer JavaScript.
- Organisation sign-in leaves the native renderer local, including macOS
  on-device speech. A true remote workspace remains classified as remote and
  receives no local speech capability.
- The private process receives only the separate model capability, never the
  device credential used for session and backup authority.
- Disconnect has a separate confirmation. Cancel preserves the connection;
  confirm clears the saved grant and requests device revocation.
- Revoked access requires disconnecting before signing in again, without
  suggesting personal billing as an automatic fallback.
- The 390px layout has no horizontal overflow.
- A remote-origin page gets neither the organisation bridge nor Node access.
- The actual fresh app still opens its existing optional welcome flow, not an
  organisation sign-in wall. Explicit Settings → Organisation works before
  completing local provider onboarding.
- A persisted old hosted selection loads the old server's page without an
  organisation bridge. Cancelling native organisation sign-in leaves the saved
  selection byte-for-byte unchanged. Confirming through the production native
  menu opens local Organisation Settings, preserves the hosted entry and does
  not enroll automatically. Recreating the renderer from the saved choice
  stays local. A completion receipt is required, not merely an exit code.

The printed evidence directory retains `receipt.json`, `electron.log`, and
connected, narrow confirmation and in-app screenshots. Cleanup removes only
the fixture's home/profile and fake-engine workspace; no user data is changed.

This is a renderer/preload/client workflow check against synthetic HTTP
responses. It substitutes an in-memory credential store, captured browser-open
requests and a fake utility-process acknowledgement. It does **not** prove
real Admin consent, OS keychain persistence, private runtime synchronization,
native provider execution, cloud backups, public DNS/TLS or paid model calls.
Provider isolation, expiry and no-personal-fallback behavior are separately
covered by `server/managed-desktop.test.ts`. Read-only Company engine settings
and preservation of personal controls have focused renderer regressions.

## Returning from a hosted workspace

Use **Server → Sign in with organisation…** in the installed desktop app, or
**Use desktop app → Open desktop app** in Admin. The fixed
`openmausbot://organization` link opens local settings only; it carries no
credentials and does not approve enrollment. Remote pages do not gain access
to the organisation bridge. Existing hosted server selections are not reset
on an ordinary update.

When a hosted workspace is selected, the native confirmation explains that
its data stays on the server. The hosted entry remains saved. In desktop
companion mode, confirming explicitly disconnects and restarts locally; the
local Settings destination is remembered in the same encrypted write. A
failed write or cancelled dialog does not disconnect. The pending destination
is consumed only when the local Organisation panel acknowledges its mount.
Relaunch arguments exclude the consumed one-shot link so later updates cannot
replay it. Restore/retry and
stale-confirmation cases are covered by
`node --test electron/organization-entry.node-test.mjs`.

The Electron smoke uses actual menu selection, renderer navigation and a
disposable saved-environments file, but substitutes native confirmation and
credential storage. It recreates the renderer rather than installing a real
update or invoking an OS protocol handler. Companion restart/keychain behavior
is controller-tested, not a production migration claim.

2026-09-20: the extended isolated desktop workflow passed. Evidence:
`/var/folders/91/pdc4mdh53xs59x0r4z7_0qzc0000gn/T/omb-organization-ui-kdmfy4/`.
Installed-app update/protocol testing and production rollout remain separate
follow-ups; no customer workspace was changed.

2026-09-16: the extended isolated Electron workflow passed, including logo
decoding, avatar selection/retrieval and removal propagation. Evidence:
`/var/folders/91/pdc4mdh53xs59x0r4z7_0qzc0000gn/T/omb-organization-ui-ndaRQH/`.
The separate private Admin/native runtime integration also passed with branding
enabled (`/tmp/omb-desktop-integration-ql2mMS/receipt.json`). Neither test used
customer accounts or changed the operator's desktop app.

## 2026-09-23 renewal, licence lapse and organisation policy

Unit and node tests only; the Electron smoke above was **not** re-run for this
change, and no installed app, keychain, production Admin or customer data was
used.

- `node --test electron/managed-desktop.node-test.mjs`: renewal on start and
  when fewer than seven days remain, only when Admin advertises
  `capabilities.deviceRenewal`; same `deviceId`; a rotated token is written to
  the encrypted record before use; a later session expiry is adopted and an
  earlier one ends access; an Admin without renewal or policies sees exactly
  today's requests; 503 `admin_license_expired` becomes `license-expired`
  (Company instances kept but suspended, no DELETE, no sign-in prompt, keeps
  polling, recovers); sign-in against an expired Admin says so; the policy is
  sent to the runtime separately from the model grant, persisted with the
  encrypted grant, re-applied before any network call after an offline
  restart, kept when a later policy is malformed, reported back to Admin, and
  lifted on disconnect, revocation or expiry.
- `node --test electron/company-backup-schedule.node-test.mjs`: a schedule
  saved under the old device-scoped key is adopted (not turned off) on upgrade
  and on re-enrolment; losing the connection pauses it; another organisation
  or account still clears it.
- `pnpm vitest run server/managed-policy.test.ts server/managed-desktop.test.ts
  server/store-rename-instances.test.ts`: refusal sentences, MCP name/address
  matching, computer-kind mapping, the real `bindTurnComputer` guard from
  `index.ts`, expiry of the last policy; renewal and licence suspension applied
  without restarting Company instances; stable Company ids across re-enrolment
  with the old id's native home and saved selections, cursors and handed
  records moved once.
- Mutation checks (each failed its test, then was restored): strict expiry
  equality on the session response; treating the licence 503 as offline;
  not restoring the saved policy on start; removing the `bindTurnComputer`
  guard; replacing instances on a renewal; skipping the legacy-id rename;
  forgetting instead of adopting a legacy backup key.
- Against the Admin itself (in the openmaus-cloud `feat/desktop-lifecycle`
  worktree, disposable fixtures): this client enrolled, reported its version
  and policy, renewed a week later to now + 30 days with the same device,
  stayed connected past the original 30 days and showed `license-expired`
  after the grace period; against the current Admin `main` it made no renewal
  call, received no policy and kept today's behaviour.

Review fixes (same day, same limits): MCP address entries are parsed as HTTPS
URLs and matched by whole host labels and path, with tests for the path,
suffix, credential, scheme, port and bare-wildcard bypasses; an enrollment
that expired or is being cleared sends its identity (never its token) so its
old ids and backup key still migrate after a later re-enrolment, and the
backup key match ignores the deviceId; migration is best effort and logged;
a disconnected computer still shows a paused daily schedule with its off
switch, and an overdue backup waits 15 minutes after the connection returns;
the saved policy is re-sent before any network call; a rotated token is
adopted only once stored; room turns refuse a disallowed place before
provisioning, the shared-computer lease honours "this computer", and room LLM
titles skip a disallowed engine. Turning the companion on is refused inside
`startDesktopCompanion` itself (switch, Tailscale "Turn on and check" and
launch auto-start); that Electron main path is checked by inspection only.

