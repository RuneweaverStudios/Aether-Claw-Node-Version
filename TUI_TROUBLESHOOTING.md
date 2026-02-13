# TUI Troubleshooting (Node)

The TUI is the Node chat interface: `node src/cli.js tui`.

## TUI exits right away or says "Goodbye!"

**Cause**: stdin is not a proper TTY (e.g. piped, or launched from an environment that doesn’t attach stdin).

**What to do**:

1. Run in a normal terminal (not via an IDE “Run” that might not attach stdin):
   ```bash
   node src/cli.js tui
   ```
2. Don’t pipe stdin:
   ```bash
   # Wrong:
   echo "" | node src/cli.js tui

   # Right:
   node src/cli.js tui
   ```
3. Check if stdin is a TTY:
   ```bash
   node -e "console.log(process.stdin.isTTY)"
   ```
   If it prints `undefined` or `false`, you’re not in an interactive terminal.

## Commands not working

- **/status, /memory, /skills, /index**: Require project files (e.g. `swarm_config.json`, `brain/`, `skills/`). Run from the project root: `cd /path/to/newclawnode && node src/cli.js tui`.
- **Action/coding**: Needs `OPENROUTER_API_KEY` in `.env`. Action path uses the agent loop with tools; if the model returns tool calls, they are executed (exec, read_file, etc.) and results are fed back.

## Node version

Use Node 18 or newer: `node --version`.

## More info

- Architecture and features: `docs/ARCHITECTURE_AND_FEATURES.md`
- Tools and workflows: `docs/OPENCLAW_TOOLS_AND_WORKFLOWS.md`
