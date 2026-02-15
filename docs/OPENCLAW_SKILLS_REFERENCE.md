# OpenClaw Bundled Skills Reference

OpenClaw ships with **50+ skills** in its [official repo](https://github.com/openclaw/openclaw/tree/main/skills). This document lists them and how Aether-Claw aligns.

## Aether-Claw bundled skills (in this repo)

| Skill | Description |
|-------|-------------|
| **cursor-agent** | Open projects in Cursor/VS Code; run Cursor CLI for coding tasks. Includes **Cursor CLI install + PATH** (use `cursor_cli_install` tool or see SKILL.md). Uses `open_in_editor`, `cursor_agent_run`, `cursor_cli_install`. |
| **composio-twitter** | X/Twitter research via Composio (optional: Bun + `COMPOSIO_API_KEY`). |

## OpenClaw skills list (from openclaw/openclaw/skills)

These are the skills bundled in the official OpenClaw repo. Many depend on OpenClaw’s full gateway, channels, or platform (e.g. macOS/iOS). Aether-Claw does not ship their code; you can copy individual skills from the OpenClaw repo into your `skills/` if you need them and adapt any platform-specific parts.

| Skill | Notes (Aether-Claw) |
|-------|----------------------|
| 1password | Vault integration; requires 1Password CLI / env |
| apple-notes | macOS Apple Notes |
| apple-reminders | macOS Reminders |
| bear-notes | Bear app (macOS/iOS) |
| blogwatcher | Blog/RSS watching |
| blucli | BlueBubbles (iMessage) CLI |
| bluebubbles | iMessage via BlueBubbles |
| camsnap | Camera snapshot (node) |
| canvas | Canvas/A2UI (Aether-Claw has **canvas tool** in code, not this skill) |
| clawhub | ClawHub skill registry |
| coding-agent | Coding workflows (conceptually close to cursor-agent) |
| discord | Discord channel actions |
| eightctl | Eight Sleep |
| food-order | Food ordering |
| gemini | Gemini-specific |
| gifgrep | GIF search |
| github | GitHub (Aether-Claw has **github_connect** tool) |
| gog | GOG gaming |
| goplaces | Places / maps |
| healthcheck | Health checks (Aether-Claw has **doctor** tool) |
| himalaya | Email (Himalaya CLI) |
| imsg | iMessage legacy |
| mcporter | Migration/porter |
| model-usage | Model usage tracking |
| nano-banana-pro | Nano Banana Pro |
| nano-pdf | PDF handling |
| notion | Notion |
| obsidian | Obsidian |
| openai-image-gen | OpenAI image generation |
| openai-whisper-api | Whisper API |
| openai-whisper | Whisper local |
| openhue | Philips Hue |
| oracle | Oracle DB |
| ordercli | Order CLI |
| peekaboo | Peekaboo |
| sag | SAG |
| session-logs | Session logs |
| sherpa-onnx-tts | TTS (Sherpa ONNX) |
| skill-creator | Create new skills |
| slack | Slack channel |
| songsee | Songsee |
| … | (others in repo) |

## Tools parity (Aether-Claw vs OpenClaw)

- **Full tool set**: Aether-Claw implements the same **tool schemas** as OpenClaw (exec, process, read_file, write_file, edit, apply_patch, memory_*, web_*, message, cron, gateway, sessions_*, agents_list, image, **canvas**, **cursor_agent_run**, **cursor_cli_install**, open_in_editor, etc.). See `docs/OPENCLAW_TOOLS_AND_WORKFLOWS.md`.
- **Stubs in Aether-Claw**: `browser` (use **canvas** for URLs), `nodes`, full `sessions_send`/`sessions_spawn` (partial).
- **Extra in Aether-Claw**: `cursor_cli_install` (Cursor CLI install + PATH), `doctor`, Ralph tools, `github_connect`, etc.

## Adding more OpenClaw-style skills

1. Copy a skill from [openclaw/openclaw/skills](https://github.com/openclaw/openclaw/tree/main/skills) into your `skills/<name>/` (include `SKILL.md` and any required files).
2. Adjust instructions if they reference OpenClaw-only features (gateway, channels, nodes).
3. Run `aetherclaw status` or the dashboard to see audit status; fix any security-audit failures.
4. Optional: use [ClawHub](https://docs.openclaw.ai/clawhub) to search/install community skills into `skills/`.
