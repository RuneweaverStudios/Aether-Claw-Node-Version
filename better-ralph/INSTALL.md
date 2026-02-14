# Better Ralph – Install and Use

Better Ralph is the PRD-driven autonomous coding loop built into **Aether-Claw Node**. It can be used as part of Aether-Claw or referenced as a workflow/skill for OpenClaw-style systems.

---

## Option 1: Use with Aether-Claw (built-in)

Better Ralph is included in Aether-Claw Node. No separate install.

### Prerequisites

- [Aether-Claw Node](https://github.com/aether-claw/aether-claw-node) (this repo) cloned and set up
- `OPENROUTER_API_KEY` in `.env` (run `aetherclaw onboard` if needed)
- A git repo with a `prd.json` in the project root

### Quick start

1. **Create a PRD**  
   Copy `better-ralph/prd.json.example` to your project root as `prd.json`. Edit `project`, `branchName`, `description`, and `userStories` (id, title, description, acceptanceCriteria, priority, passes).

2. **Run Ralph**  
   From the project root (where `prd.json` lives):

   ```bash
   aetherclaw ralph
   ```

   Or with a max iteration count:

   ```bash
   aetherclaw ralph 5
   ```

3. **Progress**  
   The first run creates `progress.txt` if missing. Each iteration: the agent gets the next story via `ralph_get_next_story`, implements it, runs checks, commits, calls `ralph_mark_story_passed` and `ralph_append_progress`. When all stories have `passes: true`, Ralph exits successfully.

### Config (optional)

In `swarm_config.json`:

```json
{
  "ralph": {
    "max_iterations": 10,
    "prd_path": "prd.json",
    "progress_path": "progress.txt"
  }
}
```

---

## Option 2: OpenClaw / skill or workflow reference

If you use **OpenClaw** or another OpenClaw-compatible assistant:

- Better Ralph is implemented as an **in-process loop** and **tools** inside Aether-Claw, not as a separate CLI. To use the same workflow elsewhere you can:
  - **Run Aether-Claw** in the project and use `aetherclaw ralph` (recommended), or
  - **Reuse the workflow and PRD format**: maintain `prd.json` and `progress.txt`, and have your agent follow the same steps (get next story, implement, quality checks, commit, mark passed, append progress) using your platform’s file and git tools.

### Skill-style integration (Aether-Claw)

Aether-Claw skills live in `skills/` and are signed JSON. To expose “Ralph” as a listed skill:

1. Create an OpenClaw-style skill (e.g. `skills/ralph/SKILL.md`) that documents the Ralph workflow and points the user to `aetherclaw ralph` and `better-ralph/README.md`.
2. Install the skill into `skills/` and list it with `aetherclaw status` or TUI `/skills`.

The actual loop and tools are in `src/ralph.js` and `src/tools/index.js` (ralph_get_next_story, ralph_mark_story_passed, ralph_append_progress); the skill is a wrapper or doc entry point.

### Using the PRD format in other tools

The PRD schema is:

- `project`, `branchName`, `description` (string)
- `userStories`: array of `{ id, title, description, acceptanceCriteria[], priority, passes, notes }`

Stories are processed in ascending `priority`; `passes` is updated to `true` when a story is done. You can generate or edit `prd.json` by hand or with your own tooling and still run Better Ralph via Aether-Claw.

---

## Option 3: Fork or publish Better Ralph as a repo

This folder (`better-ralph/`) contains:

- **README.md** – What Better Ralph is, how it works, comparison to Ralph
- **INSTALL.md** – This file (Aether-Claw, OpenClaw/skill, config)
- **prd.json.example** – Example PRD

The **implementation** lives in the parent Aether-Claw repo:

- `src/ralph.js` – Loop, RALPH_SYSTEM prompt, paths, archive
- `src/tools/index.js` – Tools: `ralph_get_next_story`, `ralph_mark_story_passed`, `ralph_append_progress`
- `src/cli.js` – `ralph` command

To publish “Better Ralph” as its own repo:

1. Create a new repo (e.g. `better-ralph`).
2. Copy in `better-ralph/` (README, INSTALL, prd.json.example).
3. Add a short note that the runtime is Aether-Claw and link to the Aether-Claw repo (or vendor a minimal runner that depends on it).

No separate npm package is required; the canonical runtime is Aether-Claw Node.
