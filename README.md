# Aether-Claw

A **secure, swarm-based AI assistant** with persistent memory, proactive automation, and cryptographically signed skills.

## Quick Install

```bash
curl -sSL https://raw.githubusercontent.com/RuneweaverStudios/aetherclaw/main/install.sh | bash
```

## Onboarding

After installation, run the interactive setup:

```bash
aetherclaw onboard
```

This will:
1. Check/configure API keys
2. Generate RSA keys for skill signing
3. Index brain memory files
4. Verify skill signatures
5. Run system health check

## API Keys

Set your OpenRouter API key (recommended):

```bash
export OPENROUTER_API_KEY="your-key"
```

Or add to `~/.aether-claw/.env`:

```
OPENROUTER_API_KEY=your-key
```

## Interfaces

```bash
aetherclaw tui         # Terminal interface with chat
aetherclaw dashboard   # Web UI (Streamlit) with chat, memory, skills
aetherclaw telegram    # Start Telegram bot for remote chat
```

## Commands

| Command | Description |
|---------|-------------|
| `onboard` | Interactive setup wizard |
| `tui` | Launch terminal interface |
| `dashboard` | Launch web dashboard |
| `telegram` | Start Telegram bot |
| `status` | Show system status |
| `heartbeat` | Run scheduled tasks |
| `sign-skill` | Create/verify signed skills |
| `verify-skills` | Verify all skill signatures |
| `kill-switch` | Manage kill switch |
| `swarm` | Execute swarm tasks |

## Features

- **Persistent Memory**: Long-term recall via Markdown-based storage with SQLite FTS5 indexing
- **Proactive Automation**: Scheduled heartbeat tasks that run autonomously
- **Cryptographic Signing**: RSA-2048 signed skills with Bandit security scanning
- **Terminal TUI**: Rich terminal interface with chat and system commands
- **Web Dashboard**: Streamlit-based UI with chat, memory search, skill management
- **Telegram Integration**: Chat with your agent remotely via Telegram bot
- **Swarm Orchestration**: Multiple AI agents working in parallel with isolation
- **Security Hardened**: Permission boundaries, audit logging, and kill switch

## Architecture

```
+-------------------+     +------------------+     +-------------------+
|   Claude Code     |---->|   Architect      |---->|   OpenRouter API  |
|   (Leader)        |     |   (Reasoning)    |     |   claude-3.5      |
+-------------------+     +------------------+     +-------------------+
                                  |
                                  v
                    +------------------------+
                    |   Swarm Orchestrator   |
                    +------------------------+
                              |
          +-------------------+-------------------+
          |                   |                   |
          v                   v                   v
    +------------+      +------------+      +------------+
    |  Worker 1  |      |  Worker 2  |      |  Worker 3  |
    |  (Action)  |      |  (Action)  |      |  (Action)  |
    +------------+      +------------+      +------------+
          |                   |                   |
          v                   v                   v
    +---------------------------------------------------+
    |              Isolation Layer (Docker/Worktree)    |
    +---------------------------------------------------+
```

## Directory Structure

```
~/.aether-claw/
├── brain/                    # Memory system
│   ├── soul.md              # Identity and goals
│   ├── user.md              # User preferences
│   ├── memory.md            # Long-term memory log
│   ├── heartbeat.md         # Proactive task config
│   ├── audit_log.md         # Immutable audit trail
│   └── brain_index.db       # SQLite FTS5 index
├── skills/                   # Signed skills registry
├── swarm/                    # Swarm orchestration
├── tasks/                    # Heartbeat tasks
├── .env                      # API keys (gitignored)
├── aether_claw.py           # Main CLI
├── tui.py                   # Terminal interface
├── dashboard.py             # Streamlit dashboard
└── swarm_config.json        # Configuration
```

## Security Model

### Skill Signing

All skills must be cryptographically signed with RSA-2048:

```bash
# Create and sign a skill
aetherclaw sign-skill --create my_skill.py --name my_skill

# List skills
aetherclaw sign-skill --list

# Verify all skills
aetherclaw verify-skills
```

### Safety Gate

Sensitive actions require confirmation:
- File writes
- Network requests
- System commands
- Skill loading

### Kill Switch

Immediate halt on security events:
- Unsigned skill execution
- Signature verification failure
- Unauthorized file access
- Resource anomalies

```bash
aetherclaw kill-switch --arm     # Arm kill switch
aetherclaw kill-switch --reset   # Reset after trigger
```

## Heartbeat Tasks

Automated tasks that run on a schedule:

| Task | Description |
|------|-------------|
| `git_repo_scan` | Scan for git repositories |
| `memory_index_update` | Update brain index |
| `skill_integrity_check` | Verify skill signatures |
| `system_health_check` | Monitor CPU/memory/disk |
| `task_list_review` | Review task lists |

## Telegram Setup

1. Create a bot via [@BotFather](https://t.me/botfather) on Telegram
2. Get your bot token
3. Get your chat ID (message @userinfobot)
4. Set environment variables:

```bash
export TELEGRAM_BOT_TOKEN="your-bot-token"
export TELEGRAM_CHAT_ID="your-chat-id"
```

5. Start the bot:

```bash
aetherclaw telegram
```

## Configuration

Edit `swarm_config.json` to customize:
- Model routing
- Safety gate settings
- Kill switch triggers
- Heartbeat interval
- Swarm worker limits

## Development

```bash
# Clone and install
git clone https://github.com/RuneweaverStudios/aetherclaw.git
cd aetherclaw
pip install -r requirements.txt

# Run onboarding
python3 aether_claw.py onboard

# Run tests
pytest

# Type checking
mypy .
```

## License

MIT License

## Acknowledgments

Inspired by OpenClaw with security as the primary design concern.
