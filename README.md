# Aether-Claw (Node.js)

Node-only, cross-platform (Windows & Mac) secure AI assistant with persistent memory, OpenRouter, and OpenClaw-style tools (exec, file edit, web search, Telegram, cron, vision).

## Quick Install (curl)

```bash
curl -sSL https://raw.githubusercontent.com/RuneweaverStudios/Aether-Claw-Node-Version/main/install.sh | bash
```

Then:

```bash
cd ~/.aether-claw-node && node src/cli.js onboard
node src/cli.js tui
```

## Manual setup

```bash
git clone https://github.com/RuneweaverStudios/Aether-Claw-Node-Version.git
cd Aether-Claw-Node-Version
npm install
node src/cli.js onboard
```

## Commands

| Command | Description |
|--------|-------------|
| `node src/cli.js onboard` | First-time setup (API key, brain, optional Telegram) |
| `node src/cli.js tui` | Chat TUI (gateway routing, tools for coding tasks) |
| `node src/cli.js dashboard` | Web UI (Chat, Status, Security, Config) at http://localhost:8501 |
| `node src/cli.js status` | Show status (index, skills, config) |
| `node src/cli.js doctor` | Health check and suggestions |
| `node src/cli.js daemon` | Run gateway daemon (heartbeat + Telegram) in foreground |
| `node src/cli.js telegram` | Run Telegram bot only (manual) |
| `node src/cli.js telegram-setup` | (Re)pair Telegram (token + pairing code) |
| `node src/cli.js index [file]` | Reindex brain for memory search |

Or use npm scripts: `npm run onboard`, `npm run tui`, `npm run dashboard`, `npm run status`, `npm run doctor`, `npm run daemon`, `npm run telegram`.

## Environment

Create `.env` (onboarding writes this):

```
OPENROUTER_API_KEY=your-key
TELEGRAM_BOT_TOKEN=optional
TELEGRAM_CHAT_ID=optional
BRAVE_API_KEY=optional (for web_search tool)
```

## Features

- **Gateway routing**: Chat, action (coding), memory, reflect — each uses the right model and system prompt.
- **Coding tasks**: For “action” messages, the agent uses tools: exec, process, read_file, write_file, edit, apply_patch, memory_search, memory_get, web_search, web_fetch, message (Telegram), cron, gateway, sessions, image (vision). See `docs/OPENCLAW_TOOLS_AND_WORKFLOWS.md`.
- **Brain**: `brain/*.md` indexed for memory search; personality in soul.md / user.md.
- **Skills**: OpenClaw-style (SKILL.md directories in `skills/`). **Included by default:** **cursor-agent** (open projects in Cursor/VS Code, run Cursor CLI for coding tasks), **composio-twitter** (X/Twitter research via Composio, zero X API cost; optional: requires Bun + `COMPOSIO_API_KEY`). Install more from ClawHub (`clawhub install <slug>`). Each skill is audited for security/prompt-injection before use; results cached. Dashboard **Security** tab shows warnings and audit status.
- **Safety**: Kill switch and safety gate (configurable) gate exec and file tools.
- **Daemon**: Installer can register a LaunchAgent that runs `node src/daemon.js` (heartbeat + Telegram). Heartbeat interval is configurable in `swarm_config.json` (`heartbeat.interval_minutes`).

## Project layout

- `src/cli.js` – CLI (onboard, tui, dashboard, doctor, daemon, telegram, status, index)
- `src/gateway.js` – Intent routing (chat / action / memory / reflect)
- `src/api.js` – OpenRouter API (with optional fallback models)
- `src/agent-loop.js` – Tool-calling loop for action (coding) tasks
- `src/tools/index.js` – All tools (exec, process, read_file, write_file, edit, apply_patch, memory_*, web_*, message, cron, gateway, sessions_*, agents_list, image; browser/canvas/nodes stubs)
- `src/dashboard.js` – HTTP server: Chat API, Status, Security, Config, Web UI (markdown + code blocks)
- `src/config.js` – Config loader (swarm_config.json + defaults)
- `src/brain.js` – Memory index (brain_index.json)
- `src/daemon.js` – Heartbeat loop + Telegram (same process)
- `brain/*.md` – soul, user, memory
- `swarm_config.json` – Model routing, safety_gate, heartbeat, cron.jobs
- `docs/ARCHITECTURE_AND_FEATURES.md` – Architecture and config
- `docs/OPENCLAW_TOOLS_AND_WORKFLOWS.md` – OpenClaw tool list and Aether-Claw parity
- `skills/cursor-agent/` – **Default.** Cursor Agent skill: open projects in Cursor/VS Code, run Cursor CLI for coding tasks (SKILL.md, README, _meta.json).
- `skills/composio-twitter/` – **Default.** X/Twitter research via Composio (zero X API cost). Optional: requires [Bun](https://bun.sh) and `COMPOSIO_API_KEY`. See [skills/composio-twitter/README.md](skills/composio-twitter/README.md) for setup.

## Documentation

- **Architecture and config**: [docs/ARCHITECTURE_AND_FEATURES.md](docs/ARCHITECTURE_AND_FEATURES.md)
- **OpenClaw tools and parity**: [docs/OPENCLAW_TOOLS_AND_WORKFLOWS.md](docs/OPENCLAW_TOOLS_AND_WORKFLOWS.md)
- **TUI troubleshooting**: [TUI_TROUBLESHOOTING.md](TUI_TROUBLESHOOTING.md)

## Requirements

- Node.js 18+
- npm

Runs on Windows and macOS.
