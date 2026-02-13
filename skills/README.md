# Skills

Skills are signed JSON files (e.g. `my_skill.json`) with `metadata`, `code`, and `signature`.

- **List/verify**: `node src/cli.js status` or TUI `/skills`
- **Sign**: use `src/safe-skill-creator.js` (signAndSaveSkill) or generate key with `src/keygen.js` first
- Keys live in `~/.claude/secure/` (see keygen.js)

No Python; this repo is Node-only.
