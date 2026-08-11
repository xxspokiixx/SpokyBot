# Grok Bot 0.16.0 → OpenGrokBot parity map

2026-08-12. Source: full CUA-driven exploration of the real app (accessibility
trees + screenshots; AX dumps in the session scratchpad). Compared against
OpenGrokBot @ `7ee9eb8`.

Layout fact established: the app is **sidebar / chat / details panel** — the
white icon rail seen in early screenshots is VS Code's activity bar behind the
window, not part of Grok Bot. Our 3-column shell is structurally correct.

## Feature map

Status: ✅ have · 🟡 partial · ❌ missing

### Shell & sidebar
| Real Grok Bot | Status | Notes |
| --- | --- | --- |
| Sidebar: bot rows (avatar/name/time/preview/unread), resizable splitter | 🟡 | rows done; no resize splitter |
| "+" → Telegram-style compose: "To:" recipients combobox, "Create new Bot", multi-select ⇒ **Groups** | ❌ | we spawn a bot directly; no compose screen, no groups |
| Search = whole-window **command palette**: tabs All/Messages/Agents/Groups/Files/Links/Routines/Actions; full-text message search with highlighting; actions (Settings tabs, Plugins, Theme System/Light/Dark, Check for Updates) | ❌ | our search input is decorative |
| Footer: Plugins row · account row ("Open account menu") | 🟡 | Plugins opens; account row inert |

### Chat
| Real Grok Bot | Status | Notes |
| --- | --- | --- |
| Streaming bubbles, date separators, "New messages" divider | 🟡 | streaming ✅; no unread divider |
| Onboarding interview card (lettered options + own answer + Dismiss) | ✅ | |
| Message hover toolbar: Add reaction / Reply / More | ❌ | |
| Right-click menu: 👍👎❤️😂🎉😮 + More emoji · **Reply · Start a thread · Copy** | ❌ | reactions + threads are a real system |
| Inline screenshot attachments from bot's computer, "Open image full screen" | 🟡 | frames render; no fullscreen viewer |
| Composer "+" menu: **Attach files** · **Teach a task** (record demonstration) | ❌ | button inert; Teach-a-task pairs with CUA later |
| Mic = inline dictation: "Listening…" + timer + waveform + stop; inline error state | 🟡 | speech helper landing in electron/ now |
| Header monitor icon toggles **details panel** | 🟡 | ours toggles a floating screen thumbnail instead |

### Details panel (the monitor icon's target)
| Real Grok Bot | Status | Notes |
| --- | --- | --- |
| "Agent settings" gear + close | 🟡 | our settings panel exists; not framed as details panel |
| Live "bot's screen" thumbnail + **Open computer** → fullscreen noVNC takeover with "Teach a task" / "Exit fullscreen" | 🟡 | thumbnail ✅ (cloud); no fullscreen takeover view |
| **Routines**: "recurring tasks this agent runs on a schedule" + Create Routine | ❌ | whole feature absent |

### Per-agent settings
| Real Grok Bot | Status | Notes |
| --- | --- | --- |
| Edit agent avatar · Name · Title · Description · Notifications toggle | 🟡 | all but avatar editing |
| (No model picker, no per-bot plugins, no delete in the real app) | — | our model picker is a deliberate addition — keep |

### App-level settings (modal, via palette)
| Real Grok Bot | Status | Notes |
| --- | --- | --- |
| General: account (email, Sign Out) · Theme · Timezone | ❌ | |
| **Execution on Local Computer**: "Ask every time" policy | ❌ | maps 1:1 to our CUA local mode — needed before shipping it |
| **Auto-review** toggle + natural-language rules ("When bot wants to: X → It should: Allow automatically"; ask-first wins; built-in checks always apply) | ❌ | the permission-broker UX; harness hook |
| Security keys (hardware approval per use) | ❌ | later |
| Usage & Billing: trial meter, Upgrade | ❌ | n/a for OSS — skip |
| Updates: update track, app version check · **VM update + Reset from snapshot** | ❌ | VM reset maps to Box driver |

### Plugins
| Real Grok Bot | Status | Notes |
| --- | --- | --- |
| Marketplace modal: **Marketplace / Yours** tabs, search, filter, category sections with counts (Featured, MCP **66**, Productivity 33, Infrastructure 39, Payments 13, …) | 🟡 | our modal is a static 5-row list; teammate's Composio connectors are the real backend |
| Plugin detail page: description, **View Source**, Add, "N connectors" | ❌ | |
| (Their marketplace is Cursor's MCP directory rebadged; VNC session literally named "cursor:2") | — | validates our MCP-as-plugin architecture |

### Platform
| Real Grok Bot | Status | Notes |
| --- | --- | --- |
| Update system (tracks, in-app check) | ❌ | later (electron-builder autoupdate) |
| Help menu: Help Center, Send Feedback | ❌ | trivial, later |
| View menu: Reload / Toggle DevTools / Full Screen | 🟡 | Electron defaults |

## Curated backlog (proposed order)

1. **Details panel** — move screen thumbnail + agent-settings entry into a real
   right column with Routines placeholder; monitor icon toggles it. Small UI
   lift, big structural parity.
2. **Command-palette search** — full-text over transcripts (harness already
   persists NDJSON), filter tabs, theme/actions. The app's whole nav lives here.
3. **Message affordances** — reactions, reply, copy, hover toolbar; threads
   can start as reply-quoting without a thread view.
4. **Compose flow ("+")** — To:-style screen with Create new Bot; groups can
   wait, the screen shouldn't.
5. **Local-computer policy UI** — "Execution on Local Computer: Ask every
   time" + first auto-review rule storage; gate CUA tool calls through it in
   the harness.
6. **Plugins marketplace v1** — tabs + search + categories over the Composio
   catalog + our built-ins (Computer, Browser); plugin detail w/ connector
   count.
7. **Teach a task** — composer "+" entry + details-panel button; records via
   CUA (screenshot cadence + input log) into a replayable task. Depends on 5.
8. **Fullscreen computer takeover** — embed the live view full-window with
   "Exit fullscreen"; local mode can show the CUA screen stream.
9. **Dictation polish** — Listening…/timer/waveform/error states around the
   speech helper.
10. **App settings modal** — General (theme, timezone, sign-out placeholder),
    Updates (version), VM reset via Box driver.

Skipped deliberately: billing/trial UI, security keys (until there's something
to protect), Electron helper-window artifacts.
