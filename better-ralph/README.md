# Better Ralph

Better Ralph is a **PRD-driven autonomous coding loop** inspired by [Ralph](https://github.com/snarktank/ralph). It runs one user story per iteration, persists progress in `progress.txt`, and uses dedicated tools so the agent doesn’t hand-edit JSON. It’s built into **Aether-Claw Node** and runs in-process with OpenRouter (no Amp or Claude Code CLI required).

---

## What it does

1. **Reads** `prd.json` – a list of user stories with `id`, `title`, `acceptanceCriteria`, `priority`, and `passes`.
2. **Each iteration**: the agent gets the next story (highest priority with `passes: false`), implements it, runs quality checks (e.g. tests, lint), commits, marks the story passed, and appends learnings to `progress.txt`.
3. **Stops** when every story has `passes: true` (or when a max iteration count is reached).

Memory between runs lives in **git history**, **progress.txt** (append-only, with an optional “Codebase Patterns” section at the top), and **prd.json** (updated `passes` flags). Each iteration is a fresh agent run with the same system prompt and tools.

---

## Comparison with Ralph

| Aspect | Ralph (snarktank/ralph) | Better Ralph |
|--------|--------------------------|--------------|
| **Runner** | Bash loop (`ralph.sh`) | Node loop in Aether-Claw (`src/ralph.js`) |
| **AI** | Amp or Claude Code (external CLI) | OpenRouter via Aether-Claw (in-process) |
| **Context** | New process per iteration | New agent run per iteration (same process) |
| **PRD / progress** | Agent edits files by hand | Dedicated tools: `ralph_get_next_story`, `ralph_mark_story_passed`, `ralph_append_progress` |
| **Config** | Prompt file (prompt.md / CLAUDE.md) | `swarm_config.ralph` (paths, max_iterations) |
| **Archive** | On branch change (bash) | On branch change (Node, to `archive/`) |

Better Ralph keeps Ralph’s design: one story per iteration, progress.txt, explicit COMPLETE, quality checks before commit. It adds first-class tools for PRD and progress so the agent doesn’t manually parse or write JSON.

---

## Features

- **One story per iteration** – Bounded context; no mega-PRs.
- **Dedicated Ralph tools** – Get next story, mark passed, append progress (no raw prd.json editing).
- **Codebase Patterns** – Optional section at the top of `progress.txt` for reusable learnings; the agent reads it via `ralph_get_next_story`.
- **Archive on branch change** – When `branchName` in `prd.json` changes, the previous run is copied to `archive/YYYY-MM-DD-branch-name/` and progress is reset.
- **Configurable** – Optional `swarm_config.ralph`: `max_iterations`, `prd_path`, `progress_path`.
- **OpenRouter only** – No dependency on Amp or Claude Code; works with any OpenRouter model configured in Aether-Claw.

---

## Requirements

- **Aether-Claw Node** (the repo that contains this folder)
- **OpenRouter API key** in `.env`
- **Git** repo and a **prd.json** in the project root (see `prd.json.example`)

---

## Usage (Aether-Claw)

From the project root (where `prd.json` lives):

```bash
# Default max iterations (10)
node src/cli.js ralph

# Custom max iterations
node src/cli.js ralph 5
```

Before the first run, create `prd.json` (e.g. copy from `better-ralph/prd.json.example`). The first run will create `progress.txt` if it doesn’t exist.

---

## PRD format

`prd.json`:

```json
{
  "project": "MyApp",
  "branchName": "ralph/feature-name",
  "description": "Short description of the feature",
  "userStories": [
    {
      "id": "US-001",
      "title": "Short title",
      "description": "As a ... I need ...",
      "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
      "priority": 1,
      "passes": false,
      "notes": ""
    }
  ]
}
```

- **priority** – Lower number = higher priority; the agent picks the highest-priority story with `passes: false`.
- **passes** – Set to `true` by the agent (via `ralph_mark_story_passed`) when the story is done and committed.

---

## Tools (for agent implementors)

When running the Ralph workflow, the agent uses:

| Tool | Purpose |
|------|--------|
| **ralph_get_next_story** | Returns the next story to implement and the Codebase Patterns section of progress.txt. If all stories are complete, returns `all_complete: true`. |
| **ralph_mark_story_passed** | Sets `passes: true` for the given story id in prd.json. |
| **ralph_append_progress** | Appends a timestamped block to progress.txt (implementation summary and learnings). |

Plus the usual Aether-Claw tools: read_file, write_file, edit, exec, git_status, git_commit, run_tests, lint, etc.

---

## Install and integration

- **Aether-Claw**: Better Ralph is built in; see [INSTALL.md](INSTALL.md) for quick start and config.
- **OpenClaw / skill**: See [INSTALL.md](INSTALL.md) for using Better Ralph as a workflow reference or as an Aether-Claw skill entry point.

---

## References

- [Ralph](https://github.com/snarktank/ralph) – Original autonomous loop (Amp / Claude Code)
- [Geoffrey Huntley’s Ralph pattern](https://ghuntley.com/ralph/)
- [Aether-Claw Node](../README.md) – Runtime and CLI
- [OpenClaw Tools and Workflows](../docs/OPENCLAW_TOOLS_AND_WORKFLOWS.md) – Tool list including Ralph tools
