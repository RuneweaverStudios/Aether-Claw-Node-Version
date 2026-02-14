# Cursor Agent Skill (Aether-Claw)

Aether-Claw skill for **opening projects in Cursor/VS Code** and **running the Cursor CLI agent** for coding tasks. Optimized and safety-aware.

## Differences from OpenClaw community cursor-agent

- **Dedicated tools**: Uses `open_in_editor` and `cursor_agent_run` instead of raw `exec`, so the agent gets clear semantics, timeouts, and consistent error handling.
- **No TTY dependency for simple cases**: `cursor_agent_run` runs `agent -p '...' --output-format text` with a configurable timeout; when it hangs (no TTY), the tool returns a clear hint (tmux or open in Cursor).
- **Safety**: Runs under Aether-Claw’s existing SYSTEM_COMMAND permission; skill text avoids prompt-injection and dangerous patterns for audit.
- **Eligibility**: Skill is always eligible; instructions tell the agent to use the tools when the user asks to open a project or run a Cursor task, and how to handle “agent not found” or timeouts.

## When this skill applies

- User asks to open a folder/project in Cursor or VS Code.
- User asks to run a coding task (refactor, fix, review, commit message, etc.) via the Cursor agent in a project.

## Tools used

| Tool                | Purpose                                      |
|---------------------|----------------------------------------------|
| `open_in_editor`    | Open a folder in Cursor or VS Code           |
| `cursor_agent_run`  | Run Cursor CLI non-interactively with a task |

See **SKILL.md** for workflows and safety notes.
