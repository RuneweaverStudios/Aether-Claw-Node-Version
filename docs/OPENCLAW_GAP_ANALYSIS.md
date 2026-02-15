# OpenClaw vs Aether-Claw: Gap Analysis

Investigation of the [official OpenClaw repo](https://github.com/openclaw/openclaw) to identify what Aether-Claw is missing. Aether-Claw is intentionally a **minimal, Node-only** variant; this doc lists gaps for prioritization, not a commitment to implement everything.

---

## 1. Channels (multi-channel)

| OpenClaw | Aether-Claw |
|----------|-------------|
| **Telegram** (grammY), **WhatsApp** (Baileys), **Discord**, **Slack**, **Google Chat**, **Signal** (signal-cli), **BlueBubbles** (iMessage), **iMessage** (legacy imsg), **Microsoft Teams**, **Matrix**, **Zalo**, **Zalo Personal**, **WebChat** | ✅ Telegram only (pairing, same reply pipeline). Others not implemented. |

**Gap:** No WhatsApp, Discord, Slack, Signal, iMessage/BlueBubbles, Google Chat, Teams, Matrix, Zalo. WebChat in OpenClaw is part of the Gateway WS; Aether-Claw has a separate HTTP dashboard with chat.

---

## 2. CLI commands

OpenClaw has many more top-level commands ([docs](https://docs.openclaw.ai/cli)):

| OpenClaw command | Aether-Claw |
|------------------|-------------|
| `setup`, `onboard`, `configure`, `config` | ✅ `onboard`, `config get/set`; ❌ no `configure` (wizard for single sections). |
| `doctor`, `gateway`, `channels` | ✅ `doctor`; ❌ no standalone `gateway` (daemon runs it); ❌ no `channels` (list/configure channels). |
| `skills`, `plugins` | ❌ No `skills` subcommand (TUI `/skills` + dashboard only); ❌ no plugins system. |
| `memory`, `message` | ❌ No `memory` CLI (only TUI `/memory` + tools); ❌ no `message send` (send to channel). |
| `agent`, `agents` | ❌ No `agent --message "..."`; ❌ no `agents add/list`. |
| `status`, `health` | ✅ `status`; ❌ no `health` (deep gateway health probes). |
| `sessions`, `logs`, `models` | ❌ No `sessions` CLI; ❌ no `logs`; ❌ no `models` (list/switch). |
| `cron`, `nodes`, `browser` | ❌ No `cron` CLI (cron in config only); ❌ no `nodes`; ❌ no `browser`. |
| `hooks`, `webhooks` | ❌ No hooks (onboard asks but doesn’t implement); ❌ no webhooks. |
| `pairing`, `docs`, `dns` | ❌ No `pairing approve` CLI (Telegram pairing is in-setup only); ❌ no `docs`/`dns`. |
| `tui`, `dashboard` | ✅ Both. |
| `reset`, `uninstall`, `update`, `security`, `sandbox`, `approvals` | ✅ `latest` (update); ❌ no `reset`/`uninstall`/`security`/`sandbox`/`approvals` CLI. |
| Plugin commands (e.g. `voicecall`) | ❌ No plugin/extension system. |

**Gap:** Missing CLI surface for: `configure`, `channels`, `skills`, `memory`, `message`, `agent`, `agents`, `health`, `sessions`, `logs`, `models`, `cron`, `nodes`, `browser`, `hooks`, `webhooks`, `pairing`, `reset`, `uninstall`, `security`, `sandbox`, `approvals`, and any plugin commands.

---

## 3. Gateway & protocol

| OpenClaw | Aether-Claw |
|----------|-------------|
| **WebSocket** gateway (control plane: sessions, presence, config, cron, webhooks, Control UI, Canvas host) | Single **HTTP** dashboard server (Chat, Status, Config). No WS protocol. Daemon = heartbeat + Telegram poll. |
| RPC: `wizard.status`, `wizard.next`, etc. | No wizard RPC. |
| Tailscale Serve/Funnel for remote access | Not implemented. |
| Gateway auth: token or password | Token in config; dashboard uses same port, no separate auth layer. |

**Gap:** No WebSocket gateway, no Tailscale, no wizard RPC, no presence. Architecture is HTTP + polling, not WS control plane.

---

## 4. Auth & models

| OpenClaw | Aether-Claw |
|----------|-------------|
| **OAuth**: Anthropic (Claude Code), OpenAI Code (Codex), etc. | **OpenRouter API key** only. |
| Multiple providers: OpenAI, Anthropic, Gemini, xAI, MiniMax, Moonshot, Synthetic, OpenCode Zen, Vercel/Cloudflare AI Gateway, custom | Single provider (OpenRouter); model choice = OpenRouter model ID. |
| Auth profiles, credential rotation, model failover | Optional `fallback` in config per tier (429/5xx). No auth profiles. |
| `agents.defaults.model`, `models.providers` | `swarm_config.json` model_routing (tier_1_reasoning, tier_2_action). |

**Gap:** No direct provider OAuth, no multi-provider config, no auth profiles. OpenRouter is the only backend.

---

## 5. Workspace & brain

| OpenClaw | Aether-Claw |
|----------|-------------|
| Workspace: `~/.openclaw/workspace` (configurable); injected files: **AGENTS.md**, **SOUL.md**, **TOOLS.md** | `brain/` (configurable via config); **soul.md**, **user.md**, **memory.md**, **identity.md**, **BOOTSTRAP.md**. No AGENTS.md/TOOLS.md. |
| Refs: [Agent workspace](https://docs.openclaw.ai/concepts/agent-workspace), [Templates BOOTSTRAP/IDENTITY/SOUL](https://docs.openclaw.ai/reference/templates) | Bootstrap ritual + first-run message; brain config awareness in system prompt. |

**Gap:** Different file names (SOUL.md vs soul.md, no TOOLS.md). OpenClaw has richer workspace templates; Aether-Claw has bootstrap + identity/soul in prompt.

---

## 6. Skills

| OpenClaw | Aether-Claw |
|----------|-------------|
| **Bundled** (51 skills in repo: peekaboo, gemini, summarize, sag, nano-banana-pro, github, notion, slack, etc.) + **managed** (`~/.openclaw/skills`) + **workspace** (`/skills`) | **Workspace only** (`skills/`). Bundled in repo: **cursor-agent**, **composio-twitter**. Optional list in onboard = ClawHub install. |
| Skill **gating**: `requires.bins`, `requires.env`, `requires.config`, `install` (brew/node/download) in SKILL.md | ✅ Same gating (bins, env); no install specs in onboarding (user runs clawhub or npm). |
| **skills.entries** in config (per-skill enabled, apiKey, env) | No per-skill config; eligibility from SKILL.md + audit. |
| **skills.load.watch** (hot reload on SKILL.md change) | No watcher; restart or new session to pick up changes. |
| **Plugins** can ship skills | No plugin system. |

**Gap:** No managed skills dir, no per-skill config (skills.entries), no skill watcher, no plugins. Onboard now offers full OpenClaw skills list via ClawHub.

---

## 7. Tools (agent loop)

| OpenClaw | Aether-Claw |
|----------|-------------|
| **browser** (managed Chrome/Chromium, CDP, snapshots, actions) | **Stub** (returns “not implemented”). |
| **nodes** (paired devices: status, notify, run, camera, screen_record, location_get) | **Stub**. |
| **sessions_send**, **sessions_spawn** (message sub-agent, spawn sub-agent) | **Stubs** (sessions_list/history/status implemented; send/spawn minimal or stub). |
| **message** (send, poll, react, read, edit, delete, pin, thread-*, search) | ✅ `message` (send to Telegram). No poll/react/read/edit/delete/pin/thread/search. |
| **exec** (host/sandbox/node, yieldMs, background, timeout, pty, security, ask) | ✅ exec (sync + background via process tool). No sandbox/node host. |
| **apply_patch** (multi-file) | ✅ Via patch command. |
| Tool **profiles** (minimal, coding, messaging, full) | No profiles; one tool set. |
| **Sandbox**: per-session Docker for non-main sessions | No Docker sandbox. |

**Gap:** browser and nodes are stubs; sessions_send/sessions_spawn not fully implemented; no tool profiles; no sandbox; message tool is send-only.

---

## 8. Hooks & automation

| OpenClaw | Aether-Claw |
|----------|-------------|
| **Hooks** (e.g. on /new: save context) | Onboard asks “Enable hooks?” but no hook system implemented. |
| **Webhooks** (inbound HTTP triggers) | Not implemented. |
| **Cron** (scheduled jobs via config + tool) | ✅ cron tool (list/add/remove/run); jobs in swarm_config.json. No cron daemon; heartbeat is the only scheduler. |
| **Gmail Pub/Sub** | Not implemented. |

**Gap:** Hooks and webhooks missing; cron is config-only (no separate cron runner).

---

## 9. Platform & apps

| OpenClaw | Aether-Claw |
|----------|-------------|
| **macOS app** (menu bar, Voice Wake, Talk Mode, WebChat, remote gateway) | Not implemented. |
| **iOS / Android nodes** (Canvas, Voice Wake, Talk Mode, camera, screen record) | Not implemented. |
| **Voice Wake** (always-on speech) | Not implemented. |
| **Talk Mode** (overlay, continuous conversation) | Not implemented. |
| **Canvas** (A2UI host, agent-driven UI) | ✅ Canvas tool (Playwright; present, navigate, eval, snapshot). No A2UI. |
| **Docker** (Dockerfile, docker-compose, sandbox images) | No Docker in repo. |

**Gap:** No native apps, no Voice Wake/Talk Mode, no iOS/Android nodes, no A2UI, no Docker.

---

## 10. Config & env

| OpenClaw | Aether-Claw |
|----------|-------------|
| **~/.openclaw/openclaw.json** (single config file) | **swarm_config.json** + **.env** (project-local or install-dir). |
| **OPENCLAW_STATE_DIR**, **OPENCLAW_CONFIG_PATH**, **OPENCLAW_HOME** | No env-based path overrides (config path from CWD/install). |
| **OPENCLAW_GATEWAY_TOKEN** / **OPENCLAW_GATEWAY_PASSWORD** | gateway.auth.token in swarm_config.json. |
| Channel tokens in config or env (DISCORD_BOT_TOKEN, SLACK_*, etc.) | TELEGRAM_* in .env only. |
| **BRAVE_API_KEY**, **PERPLEXITY_API_KEY**, **FIRECRAWL_API_KEY**, **ELEVENLABS_API_KEY**, **DEEPGRAM_API_KEY** | BRAVE_API_KEY in .env (web_search). Others not used. |

**Gap:** Different config layout; no OPENCLAW_* env conventions; fewer channel and tool API key options.

---

## 11. Security & approvals

| OpenClaw | Aether-Claw |
|----------|-------------|
| **Sandbox** (Docker per non-main session) | No sandbox. |
| **Approvals** (e.g. exec approval flow) | Safety gate (kill switch, gating); no interactive approval CLI. |
| **Doctor** (migrations, risky DM policy) | ✅ doctor (health check, suggestions). |
| **Pairing** (pairing approve via CLI) | Pairing is in telegram-setup flow only; no `pairing approve` command. |

**Gap:** No sandbox, no approvals CLI, pairing only during setup.

---

## 12. Extensions & plugins

| OpenClaw | Aether-Claw |
|----------|-------------|
| **Extensions** (extensions/ in repo) | Not implemented. |
| **Plugins** (openclaw.plugin.json, plugin skills) | Not implemented. |
| **extensionAPI.ts** | N/A. |

**Gap:** No extension or plugin system.

---

## 13. Logging & observability

| OpenClaw | Aether-Claw |
|----------|-------------|
| **logger.ts**, **logging.ts**, **logging/** | No structured logger; console in daemon. |
| **Logging** docs (levels, rotation) | audit_log.md (append-only); no rotation. |

**Gap:** No structured logging or log rotation.

---

## 14. Testing & quality

| OpenClaw | Aether-Claw |
|----------|-------------|
| **Vitest** (unit, e2e, gateway, extensions) | No test suite in repo. |
| **Pre-commit** (markdownlint, shellcheck, etc.) | Not in repo. |

**Gap:** No automated tests or pre-commit hooks.

---

## Summary (prioritized for Aether-Claw)

**High impact, feasible in Node:**

- **Hooks** – onboard asks but doesn’t implement; simple event hooks (e.g. on /new) would close the loop.
- **`configure`** – wizard for single sections (e.g. `aetherclaw configure --section web`) without full onboard.
- **`message send`** – send a message to Telegram (or future channel) from CLI.
- **`pairing approve`** – approve pairing from CLI when using Telegram.
- **Health** – `aetherclaw health` or `status --deep` with gateway/dashboard reachability.
- **Sessions send/spawn** – actually message or spawn sub-agents if multi-session is a goal.

**Medium impact, more work:**

- **Multi-channel** – Discord/Slack adapters (similar to Telegram) for more surfaces.
- **Browser tool** – optional Playwright-based browser (or delegate to a skill).
- **Skill watcher** – reload skills on SKILL.md change.
- **Per-skill config** – skills.entries-style enable/apiKey/env in config.

**Lower priority / out of scope for “minimal”:**

- WebSocket gateway, Tailscale, OAuth, native apps, Voice Wake, nodes, Docker, plugins, full OpenClaw parity.

---

## References

- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [OpenClaw docs](https://docs.openclaw.ai)
- [OpenClaw CLI reference](https://docs.openclaw.ai/cli)
- [OpenClaw tools](https://docs.openclaw.ai/tools)
- [OpenClaw wizard reference](https://docs.openclaw.ai/reference/wizard)
- Aether-Claw: `docs/ARCHITECTURE_AND_FEATURES.md`, `docs/OPENCLAW_TOOLS_AND_WORKFLOWS.md`
