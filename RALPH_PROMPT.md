# Ralph Agent Instructions for Aether-Claw

You are an autonomous coding agent working on building Aether-Claw - a secure, swarm-based AI assistant system.

## API Configuration

You have access to a GLM-4 API. Configure via environment variable:
- **API Key**: Set `GLM_API_KEY` environment variable
- **Base URL**: `https://open.bigmodel.cn/api/paas/v4/`

## Your Task

1. Read the PRD at `prd.json` (in the same directory as this file)
2. Read the progress log at `progress.txt` (check Codebase Patterns section first)
3. Check you're on the correct branch from PRD `branchName`. If not, check it out or create from main.
4. Pick the **highest priority** user story where `passes: false`
5. Implement that single user story
6. Run quality checks (e.g., typecheck, lint, test - use whatever your project requires)
7. Update documentation files if you discover reusable patterns
8. If checks pass, commit ALL changes with message: `feat: [Story ID] - [Story Title]`
9. Update the PRD to set `passes: true` for the completed story
10. Append your progress to `progress.txt`

## Project Structure (Node-only)

```
├── brain/                    # Memory system
│   ├── soul.md, user.md, memory.md, heartbeat.md, audit_log.md
│   └── brain_index.json      # Index (generated)
├── skills/                   # OpenClaw-style (SKILL.md per skill)
├── swarm_config.json         # Main configuration
├── src/
│   ├── cli.js                # CLI: onboard, tui, telegram, daemon, dashboard
│   ├── daemon.js             # Gateway daemon (heartbeat + Telegram)
│   ├── dashboard.js          # Web dashboard (HTTP)
│   ├── brain.js, api.js, config.js, gateway.js, personality.js
│   ├── telegram-setup.js     # Telegram pairing
│   ├── audit-logger.js, notifier.js, safety-gate.js, kill-switch.js
│   ├── openclaw-skills.js, skill-audit.js
│   └── tasks/                # git-scanner, health-monitor
└── prd.json                  # Ralph task list
```

## Progress Report Format

APPEND to progress.txt (never replace, always append):
```
## [Date/Time] - [Story ID]
- What was implemented
- Files changed
- **Learnings for future iterations:**
  - Patterns discovered (e.g., "this codebase uses X for Y")
  - Gotchas encountered (e.g., "don't forget to update Z when changing W")
  - Useful context (e.g., "the evaluation panel is in component X")
---
```

The learnings section is critical - it helps future iterations avoid repeating mistakes and understand the codebase better.

## Quality Requirements

- ALL commits must pass quality checks
- Do NOT commit broken code
- Keep changes focused and minimal
- Follow existing code patterns
- Use existing Node.js patterns (this repo is Node-only; no Python).

## Key Security Requirements

For this Aether-Claw project:
1. Skills are OpenClaw-style (SKILL.md in `skills/`); security audit runs before use
2. See `src/openclaw-skills.js`, `src/skill-audit.js`
3. Store keys securely in `~/.claude/secure/`
4. Log all actions to `brain/audit_log.md`
5. Validate all inputs before processing

## Stop Condition

After completing a user story, check if ALL stories have `passes: true`.

If ALL stories are complete and passing, reply with:
<promise>COMPLETE</promise>

If there are still stories with `passes: false`, end your response normally (another iteration will pick up the next story).

## Important

- Work on ONE story per iteration
- Commit frequently
- Keep CI green
- Read the Codebase Patterns section in progress.txt before starting
