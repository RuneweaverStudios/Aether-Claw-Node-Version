# Skills (OpenClaw-style)

Skills are **OpenClaw-compatible** directories: each skill is a folder under `skills/` containing a **SKILL.md** file with YAML frontmatter and instructions. The agent sees the list of eligible skills in its system prompt and follows their instructions when relevant.

## Bundled by default

Aether-Claw includes three skills in the repo:

- **humanizer** — Removes signs of AI-generated writing so text sounds natural and human. Based on [blader/humanizer](https://github.com/blader/humanizer) and Wikipedia's "Signs of AI writing." **Applied by default to all agent replies** (writing-style rules are in the system prompt). When the user asks to "humanize" or "rewrite to sound more human," the agent can read `skills/humanizer/SKILL.md` and follow the full guide. No extra deps.
- **cursor-agent** — Open projects in Cursor/VS Code; run the Cursor CLI for coding tasks (refactor, fix, review). Includes **Cursor CLI install and PATH setup**: use the `cursor_cli_install` tool (action: `instructions` or `install`) when the user needs to fix "agent: command not found" or add the Cursor CLI to PATH. Uses `open_in_editor`, `cursor_agent_run`, and `cursor_cli_install`. No extra deps.
- **composio-twitter** — X/Twitter research via [Composio](https://composio.dev) (zero X API cost). Optional: requires [Bun](https://bun.sh) and `COMPOSIO_API_KEY`. See `skills/composio-twitter/README.md` for setup.

For the full list of **OpenClaw bundled skills** (50+) and how they map to Aether-Claw, see [docs/OPENCLAW_SKILLS_REFERENCE.md](../docs/OPENCLAW_SKILLS_REFERENCE.md).

When you run **`aetherclaw latest`**, OpenClaw skills are synced from GitHub into `skills/` (reserved names `cursor-agent` and `composio-twitter` are never overwritten).

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

- **List/status**: `aetherclaw status`, TUI `/skills`, or dashboard **Status** and **Security** tabs.
- **Doctor**: Reports how many skills passed or failed audit.
