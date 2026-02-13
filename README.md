# Aether-Claw (Node.js)

Cross-platform (Windows & Mac) version of Aether-Claw — secure AI assistant with persistent memory and OpenRouter.

## Quick Install (curl)

```bash
curl -sSL https://raw.githubusercontent.com/RuneweaverStudios/Aether-Claw-Node-Version/main/install.sh | bash
```

This installs to `~/.aether-claw-node`, then run:

```bash
cd ~/.aether-claw-node && node src/cli.js onboard
node src/cli.js tui
```

## Manual Setup

```bash
git clone https://github.com/RuneweaverStudios/Aether-Claw-Node-Version.git
cd Aether-Claw-Node-Version
npm install
```

## First-time onboarding

```bash
node src/cli.js onboard
```

You’ll be prompted for your OpenRouter API key; it’s saved to `.env`.

## Commands

| Command | Description |
|--------|-------------|
| `node src/cli.js onboard` | First-time setup (API key, brain) |
| `node src/cli.js tui`     | Chat TUI |
| `node src/cli.js status` | Show status |

Or use npm:

```bash
npm run onboard
npm run tui
npm run status
```

## Environment

Create `.env` (or use onboarding):

```
OPENROUTER_API_KEY=your-key
```

## Project layout

- `src/cli.js`   – CLI entry (onboard, tui, status)
- `src/config.js` – Config loader
- `src/api.js`   – OpenRouter API client
- `src/brain.js` – Memory index (JSON-based, no native deps)
- `brain/*.md`   – soul, user, memory
- `swarm_config.json` – Model and safety settings

## Requirements

- Node.js 18+
- npm

Runs on both Windows and macOS.
