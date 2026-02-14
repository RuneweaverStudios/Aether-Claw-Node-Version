---
name: cursor-agent
version: 1.0.0
description: Open projects in Cursor/VS Code and run the Cursor CLI agent for coding tasks (refactor, fix, review). Aether-Claw optimized with dedicated tools and safety.
author: Aether-Claw
metadata: {"openclaw":{"requires":{}}}
---

# Cursor Agent Skill (Aether-Claw)

Use this skill when the user wants to:
- **Open a project in Cursor or VS Code** (e.g. "open newclawnode in Cursor", "open that folder in vscode")
- **Run a coding task via the Cursor CLI** (refactor, fix a bug, code review, generate commit message, run tests, etc.) in a specific project folder

## Tools to use

1. **open_in_editor** – When the user asks to open a folder/project in Cursor or VS Code.
   - Use the `path` argument: absolute path, or `~/Desktop/foldername`, or path relative to the current workspace.
   - Example: "open newclawnode in vscode" → `open_in_editor` with `path` like `~/Desktop/newclawnode` or the workspace-relative path.

2. **cursor_agent_run** – When the user wants the Cursor CLI to perform a coding task in a project (non-interactive).
   - Required: `prompt` – clear task description (e.g. "Refactor src/utils.js for readability", "Fix the bug in api.js", "Generate a conventional commit message for staged changes").
   - Optional: `workdir` – project path relative to workspace (default: current project).
   - Optional: `timeout_seconds` – max wait (default 180).
   - Optional: `force` – set true to let Cursor auto-apply changes without confirmation.
   - The tool runs `agent -p '<prompt>' --output-format text` in that directory. If the run times out or hangs, suggest the user run the task in a terminal (or use tmux) or open the project in Cursor and run it there.

## Workflows

### Open project in editor
- User says "open X in Cursor" or "open X in vscode" → use **open_in_editor** with the folder path. Resolve Desktop paths like `~/Desktop/newclawnode` if the user mentioned a Desktop folder.

### Run Cursor agent on current project
- User says "have Cursor refactor this file" or "run Cursor agent to fix the bug in api.js" → use **cursor_agent_run** with a clear `prompt` and leave `workdir` empty (current workspace).

### Run Cursor agent on another project
- User specifies a different project (e.g. "run Cursor on ~/Desktop/newclaw") → use **cursor_agent_run** with `prompt` and `workdir` set to that project (relative to workspace if applicable, or ask the user for the path and use a path the tool accepts).

### When Cursor CLI is not installed
- If **cursor_agent_run** returns that `agent` was not found, reply with the install hint (install Cursor CLI, then `agent login`) and suggest **open_in_editor** so the user can work in the Cursor app instead.

### When run times out
- If **cursor_agent_run** returns a timeout/hang message, suggest: run the same task in a terminal where Cursor CLI has a TTY, or use tmux for automation, or open the project in Cursor with **open_in_editor** and run the task inside the editor.

## Safety

- Only run **cursor_agent_run** for tasks the user explicitly requested. Do not run it for unrelated or speculative edits.
- Prefer **open_in_editor** when the user just wants to open a project; use **cursor_agent_run** when they want an automated coding task run in that project.

## Quick reference

| User intent              | Tool               | Key args        |
|--------------------------|--------------------|-----------------|
| Open folder in Cursor/VS Code | open_in_editor     | path            |
| Run Cursor task in project    | cursor_agent_run   | prompt, workdir? |
