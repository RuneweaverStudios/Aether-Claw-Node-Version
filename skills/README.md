# Skills (OpenClaw-style)

Skills are **OpenClaw-compatible** directories: each skill is a folder under `skills/` containing a **SKILL.md** file with YAML frontmatter and instructions. The agent sees the list of eligible skills in its system prompt and follows their instructions when relevant.

## Bundled by default

Aether-Claw includes two skills in the repo:

- **cursor-agent** — Open projects in Cursor/VS Code; run the Cursor CLI for coding tasks (refactor, fix, review). Uses `open_in_editor` and `cursor_agent_run` tools. No extra deps.
- **composio-twitter** — X/Twitter research via [Composio](https://composio.dev) (zero X API cost). Optional: requires [Bun](https://bun.sh) and `COMPOSIO_API_KEY`. See `skills/composio-twitter/README.md` for setup.

Both are audited and appear in the Skills status during onboarding.

## Format

- **Location**: `skills/<skill-name>/SKILL.md` (and optional supporting files in the same folder).
- **SKILL.md**: Start with YAML frontmatter between `---` lines, then the instruction body (markdown).

Example:

```markdown
---
name: my-skill
description: Short description for the agent
metadata: {"openclaw":{"requires":{"bins":["some-cli"]}}}
---

Use this skill when the user asks for X. Steps: 1. ... 2. ...
```

- **name**, **description**: Required (single-line).
- **metadata**: Optional single-line JSON; `metadata.openclaw.requires` can list `bins` or `env` for gating (skill is only eligible when those are present).

## Creation

1. Create a directory: `skills/my-skill/`.
2. Add `SKILL.md` with frontmatter and instructions.
3. The next session will pick it up. New skills are **audited** (security/prompt-injection check) before being included in the prompt; failed skills are excluded and shown in the dashboard **Security** tab.

## ClawHub

Install community skills from [ClawHub](https://docs.openclaw.ai/clawhub):

```bash
npm i -g clawhub   # or pnpm add -g clawhub
clawhub search "calendar"
clawhub install <skill-slug>
```

By default, `clawhub install` puts skills into `./skills`. Aether-Claw reads the same layout, so installed skills are discovered automatically.

## Security audit

Before a skill is used (included in the system prompt), it is checked for:

- Prompt-injection patterns (e.g. "ignore previous instructions", "you are now").
- Dangerous or suspicious instruction patterns.

Results are **cached** in `brain/skill_audit_cache.json`. Skills that pass are marked safe and not rescanned until their content changes. Skills that fail are excluded from the prompt and listed in the dashboard **Security** tab with warnings.

- **List/status**: `node src/cli.js status`, TUI `/skills`, or dashboard **Status** and **Security** tabs.
- **Doctor**: Reports how many skills passed or failed audit.
