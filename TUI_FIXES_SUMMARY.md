# TUI (Node) – Summary

## Current stack

- **Runtime**: Node.js (no Python). TUI is `aetherclaw tui`.
- **Input**: Node `readline` interface on `process.stdin` / `process.stdout`. Requires an interactive TTY for the main loop.

## Behavior

- **Gateway routing**: User input is classified (chat / action / memory / reflect). Action messages run the **agent loop** with tools (exec, read_file, write_file, etc.); others use a single LLM call with the appropriate system prompt.
- **Slash commands**: `/status`, `/memory <query>`, `/skills`, `/index`, `/clear`, `/new`, `/reset`, `/help`, `/quit`.

## If TUI exits immediately or misbehaves

1. **Run in a real terminal** (not from an IDE “run” that may not attach stdin):  
   `aetherclaw tui`
2. **Check stdin**: If stdin is piped or closed, readline may get EOF. Run without piping:  
   `aetherclaw tui` (no `|` or `< file`).
3. **Onboarding hatch**: If you launch TUI from onboarding, the process is spawned with inherited stdio; it should work in a normal terminal.
4. **Node version**: Node 18+.

## Files

- `src/cli.js` – CLI entry; TUI loop and slash-command handling.
- `src/gateway.js` – Intent classification.
- `src/agent-loop.js` – Tool-calling loop for action (coding) tasks.
