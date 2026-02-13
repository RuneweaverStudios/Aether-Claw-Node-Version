# Aether-Claw Node: Architecture, Config & Features

## Is the gateway daemon what makes processes persistent?

**Yes.** The “gateway daemon” is the thing that keeps background processes running in a persistent way.

- **Without the daemon**: You run `node src/cli.js telegram` or `node src/cli.js daemon` yourself. When you close the terminal or the process exits, everything stops. Nothing runs in the background.
- **With the daemon**: On macOS, the installer registers a **LaunchAgent** (`com.aetherclaw.heartbeat`) that runs **Node** as a **long-lived process**:
  - **Command**: `node src/daemon.js` (or `node src/cli.js daemon`)
  - **Starts at login** (`RunAtLoad`)
  - **Restarts if it crashes** (`KeepAlive`)
  - **Runs in the background** (no terminal needed)
  - **No Python required** – this version is Node-only.

So **persistence** = the OS (LaunchAgent) keeps the gateway process alive and restarts it. The “gateway daemon” is that one Node process; it runs:

1. **Heartbeat loop** – every 30 min, indexes brain files (memory index update).  
2. **Telegram bot** – same process polls Telegram and replies via OpenRouter when `TELEGRAM_BOT_TOKEN` is set.

Both run inside a single Node process; no Python or subprocesses.

---

## How the bot & config work

### Config files

| File | Purpose |
|------|--------|
| **`.env`** | Secrets only (not committed). `OPENROUTER_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. |
| **`swarm_config.json`** | Model routing, safety, brain path. Committed. |

### Bot / model routing

- **OpenRouter** is the only LLM provider in the Node version. All chat and Telegram replies go through `src/api.js` → OpenRouter.
- **Two tiers** (in `swarm_config.json`):
  - **tier_1_reasoning** – used for general chat, memory-aware replies, planning/reflect. Default e.g. `anthropic/claude-3.7-sonnet`.
  - **tier_2_action** – used when the gateway classifies the user message as “action” (code, scripts, quick tasks). Default e.g. `anthropic/claude-3.7-haiku`.
- **Gateway** (`src/gateway.js`) classifies each user message into:
  - **chat** → reasoning model, chat system prompt  
  - **action** → action model, action system prompt (code/tasks)  
  - **memory** → reasoning model + injected memory search results  
  - **reflect** → reasoning model, planning/reflection prompt  

So “bot config” = **`.env`** (who you are on OpenRouter + Telegram) + **`swarm_config.json`** (which models and how they’re used). No separate “bot config” file; Telegram is enabled whenever `TELEGRAM_BOT_TOKEN` (and pairing) is set.

---

## Features and abilities of Aether-Claw Node

### 1. **Interfaces**

- **TUI** – `node src/cli.js tui`  
  Terminal chat with gateway routing, slash commands, memory search, and indexing.
- **Telegram** – Bot runs either:
  - Manually: `node src/cli.js telegram`, or  
  - Automatically as a subprocess of the **gateway daemon** (when installed via install.sh).
- **Web dashboard** – `node src/cli.js dashboard` (Node HTTP server; status + simple UI).

### 2. **Coding tasks (OpenClaw-style)**

For **action**-classified messages, the agent runs with **tools**: exec, process, read_file, write_file, memory_search. The model can run commands, read/write files, and search memory; results are fed back until a final reply. See `docs/OPENCLAW_TOOLS_AND_WORKFLOWS.md` for the full OpenClaw tool list. Exec and file tools respect the kill switch and safety gate.

### 3. **Onboarding & setup**

- **Onboard** – `node src/cli.js onboard`  
  First-time setup: OpenRouter API key (masked), model choice (reasoning + action), brain dir creation, optional Telegram pairing, then hatch (TUI / Web / Exit).
- **Telegram-only** – `node src/cli.js telegram-setup`  
  (Re)connect Telegram (token + pairing code); writes `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to `.env`.

### 4. **Brain & personality**

- **Brain** – `brain/` (user.md, soul.md, memory.md, etc.). Personality module (`src/personality.js`) updates **user.md** and **soul.md** from first-run questions (name, agent name, vibe).
- **Memory** – Free-form text in `brain/memory.md` (and optionally other files). Indexed into `brain/brain_index.json` for semantic-style search.
- **Index** – `node src/cli.js index [file]`  
  (Re)index brain files for memory search. Run after editing memory.

### 5. **TUI slash commands & gateway**

- **/status** – Config summary, index file count, skills list, brain path.  
- **/memory &lt;query&gt;** – Search brain index and show snippets.  
- **/skills** – List skills in `skills/` (signed/unsigned).  
- **/index** – Re-run index of brain.  
- **/clear** – Clear screen.  
- **/help** – List commands.  
- **Any other input** – Sent through the **gateway** (chat / action / memory / reflect) and answered with the appropriate model and system prompt.

### 6. **Gateway daemon (persistence + background work)**

- **What it is**: One long-lived **Node** process (`node src/daemon.js`) managed by the macOS LaunchAgent. **No Python required.**
- **What it runs**:
  - **Heartbeat loop** – Every 30 min, runs memory index update (indexes `brain/*.md` into `brain_index.json`).
  - **Telegram bot** – Same process polls Telegram and replies via OpenRouter when `TELEGRAM_BOT_TOKEN` is set in `.env`.
- **Access**: Same install directory, same `.env` and `swarm_config.json`, same `brain/`. So the bot and heartbeat have the same config and “abilities” as the TUI (OpenRouter + brain), running in the background.

### 7. **Skills**

- **Location** – `skills/` directory.  
- **Usage** – TUI can list skills (`/skills`). Heartbeat runs **skill integrity check** (signatures / hashes). The Node version does not execute arbitrary skill code from the TUI; skills are for listing and integrity.

### 8. **Access and security**

- **Network**: OpenRouter API (HTTPS), Telegram API (HTTPS). No other outbound services required for core Node flows.
- **Filesystem**: Read/write to install directory (brain, index, config, .env). No system-wide or arbitrary path access by default.
- **Secrets**: Only in `.env`; not committed. API key input is masked during onboarding.
- **Safety**: `swarm_config.json` can include `safety_gate.enabled`; the Node TUI doesn’t execute user-requested code or shell commands, it only routes to LLMs and local file ops (index, memory search).

---

## Short summary

- **Persistence** = gateway daemon = LaunchAgent running `node src/daemon.js`, which runs the heartbeat loop and (when configured) the Telegram bot in the same process.
- **Bot config** = `.env` (OpenRouter + Telegram) + `swarm_config.json` (model tiers, optional fallback). Telegram “is on” when token (and pairing) is set; it runs either manually or via the daemon.
- **Features** = TUI (gateway-routed chat, memory, index, slash commands, /new, /reset), Telegram (same LLM + config), onboarding/personality, brain/memory/index, web dashboard, doctor (health check), model failover, and background heartbeat + Telegram when the gateway daemon is installed.

---

## Comparison with OpenClaw

[OpenClaw](https://github.com/openclaw/openclaw) is a full-featured personal AI assistant (Gateway WebSocket, multi-channel, Voice Wake, Canvas, companion apps). Aether-Claw Node is a **Node-only, minimal** variant with overlapping core capabilities:

| Capability | OpenClaw | Aether-Claw Node |
|------------|----------|------------------|
| **Onboarding wizard** | `openclaw onboard` | ✅ `node src/cli.js onboard` |
| **Gateway daemon (persistent)** | launchd/systemd, WS gateway | ✅ LaunchAgent runs `node src/daemon.js` (heartbeat + Telegram) |
| **Telegram** | grammY, pairing | ✅ Pairing code flow, same process in daemon |
| **DM / pairing** | Pairing code for unknown senders | ✅ Telegram pairing code before processing |
| **Chat commands** | /status, /new, /reset, /compact, /think, etc. | ✅ /status, /new, /reset, /memory, /skills, /index, /clear, /help |
| **Doctor (health check)** | `openclaw doctor` | ✅ `node src/cli.js doctor` |
| **Session reset** | /new, /reset | ✅ /new, /reset in TUI |
| **Model failover** | Auth rotation + fallbacks | ✅ Optional `fallback` in swarm_config per tier (429/5xx retry) |
| **Brain / personality** | AGENTS.md, SOUL.md, USER, workspace | ✅ brain/soul.md, user.md, memory.md, personality setup |
| **Skills** | Workspace skills, ClawHub | ✅ Signed skills in `skills/`, integrity check in heartbeat |
| **Scheduled tasks** | Cron, webhooks | ✅ Heartbeat (index, git scan, skill check) every 30 min |
| **Web dashboard** | Control UI + WebChat | ✅ Simple status dashboard (Node HTTP) |
| **Safety** | Safety gate, sandbox for groups | ✅ safety-gate.js, kill-switch.js, audit-logger.js |
| **Multi-channel** | WhatsApp, Slack, Discord, etc. | Telegram only (extensible) |
| **Voice / Canvas / Nodes** | Voice Wake, A2UI, iOS/Android nodes | ❌ Not in scope (Node CLI/TUI + Telegram) |
| **OAuth subscriptions** | Anthropic/OpenAI OAuth | OpenRouter API key only |
| **Runtime** | Node ≥22 | Node ≥18 |

Aether-Claw Node keeps the same **local-first, pairing, brain, skills, and daemon** ideas as OpenClaw while staying minimal and Node-only.
