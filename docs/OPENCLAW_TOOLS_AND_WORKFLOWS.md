# OpenClaw Tools and Workflows Reference

Canonical list of **built-in tools** and **tool groups** in OpenClaw (from [docs.openclaw.ai/tools](https://docs.openclaw.ai/tools)), plus recommended workflows. Aether-Claw implements the full tool set (24 tools; browser, canvas, nodes, sessions_send, sessions_spawn are stubs) and the same agent-loop pattern.

---

## Tool groups (shorthands)

| Group | Expands to |
|-------|------------|
| `group:runtime` | `exec`, `bash`, `process` |
| `group:fs` | `read`, `write`, `edit`, `apply_patch` |
| `group:sessions` | `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`, `session_status` |
| `group:memory` | `memory_search`, `memory_get` |
| `group:web` | `web_search`, `web_fetch` |
| `group:ui` | `browser`, `canvas` |
| `group:automation` | `cron`, `gateway` |
| `group:messaging` | `message` |
| `group:nodes` | `nodes` |
| `group:openclaw` | All built-in OpenClaw tools (excludes provider plugins) |

---

## Tool profiles

| Profile | Tools included |
|---------|----------------|
| `minimal` | `session_status` only |
| `coding` | `group:fs`, `group:runtime`, `group:sessions`, `group:memory`, `image` |
| `messaging` | `group:messaging`, `sessions_list`, `sessions_history`, `sessions_send`, `session_status` |
| `full` | No restriction (same as unset) |

---

## Built-in tools (inventory)

### Runtime (coding)

| Tool | Description |
|------|-------------|
| **exec** | Run shell commands in the workspace. Params: `command` (required), `workdir`, `env`, `yieldMs` (auto-background after ms, default 10000), `background`, `timeout` (default 1800s), `pty`, `host` (sandbox \| gateway \| node), `security`, `ask`, `node`. Returns `sessionId` when backgrounded. |
| **bash** | Same family as exec (group:runtime). |
| **process** | Manage background exec sessions. Actions: `list`, `poll`, `log`, `write`, `kill`, `clear`, `remove`. Scoped per agent. |

### File system

| Tool | Description |
|------|-------------|
| **read** | Read file contents (path relative to workspace). |
| **write** | Write content to a file. |
| **edit** | Edit file (in-place edits). |
| **apply_patch** | Apply structured multi-file patches (multi-hunk). Experimental; OpenAI models only via `tools.exec.applyPatch.enabled`. |

### Sessions

| Tool | Description |
|------|-------------|
| **sessions_list** | List sessions. Params: `kinds?`, `limit?`, `activeMinutes?`, `messageLimit?`. |
| **sessions_history** | Transcript for a session. Params: `sessionKey`/`sessionId`, `limit?`, `includeTools?`. |
| **sessions_send** | Send message to another session. Params: `sessionKey`/`sessionId`, `message`, `timeoutSeconds?`. |
| **sessions_spawn** | Start sub-agent run; returns `status: "accepted"`. Params: `task`, `label?`, `agentId?`, `model?`, `runTimeoutSeconds?`, `cleanup?`. |
| **session_status** | Current (or specified) session status. Params: `sessionKey?`, `model?`. |

### Memory

| Tool | Description |
|------|-------------|
| **memory_search** | Search agent memory. |
| **memory_get** | Get memory by key/id. |

### Web

| Tool | Description |
|------|-------------|
| **web_search** | Search the web (Brave Search API). Params: `query` (required), `count` (1–10). Requires `BRAVE_API_KEY`. |
| **web_fetch** | Fetch URL and extract content (HTML → markdown/text). Params: `url`, `extractMode`, `maxChars`. |

### UI

| Tool | Description |
|------|-------------|
| **browser** | OpenClaw-managed browser. Actions: `status`, `start`, `stop`, `tabs`, `open`, `focus`, `close`, `snapshot`, `screenshot`, `act`, `navigate`, `console`, `pdf`, `upload`, `dialog`. Profile management: `profiles`, `create-profile`, `delete-profile`, `reset-profile`. |
| **canvas** | Node Canvas. Actions: `present`, `hide`, `navigate`, `eval`, `snapshot`, `a2ui_push`, `a2ui_reset`. |

### Nodes

| Tool | Description |
|------|-------------|
| **nodes** | Paired nodes (macOS/iOS/Android/headless). Actions: `status`, `describe`, `pending`, `approve`, `reject`, `notify`, `run`, `camera_snap`, `camera_clip`, `screen_record`, `location_get`. |

### Media & messaging

| Tool | Description |
|------|-------------|
| **image** | Analyze image with image model. Params: `image` (path/URL), `prompt?`, `model?`, `maxBytesMb?`. |
| **message** | Send/receive across channels (Discord, Slack, Telegram, WhatsApp, etc.). Actions: `send`, `poll`, `react`, `read`, `edit`, `delete`, `pin`, `thread-*`, `search`, etc. |

### Automation

| Tool | Description |
|------|-------------|
| **cron** | Cron jobs and wakeups. Actions: `status`, `list`, `add`, `update`, `remove`, `run`, `runs`, `wake`. |
| **gateway** | Gateway control. Actions: `restart`, `config.get`/`config.schema`, `config.apply`, `config.patch`, `update.run`. |

### Agent coordination

| Tool | Description |
|------|-------------|
| **agents_list** | List agent ids that can be targeted with `sessions_spawn` (per allowlist). |

---

## Optional / plugin tools

| Tool | Description |
|------|-------------|
| **Lobster** | Typed workflow runtime with resumable approvals (Lobster CLI on gateway). |
| **LLM Task** | JSON-only LLM step for structured workflow output (optional schema validation). |
| **Voice Call** | Plugin. |
| **Zalo** | Plugin. |

---

## Recommended workflows (OpenClaw)

- **Browser automation**: `browser` → `status`/`start` → `snapshot` (aria/ai) → `act` (click/type/press) → optional `screenshot`.
- **Canvas render**: `canvas` → `present` → optional `a2ui_push` → `snapshot`.
- **Node targeting**: `nodes` → `status` → `describe` on chosen node → `notify` / `run` / `camera_snap` / `screen_record`.
- **Coding (run + iterate)**: `exec` (foreground for quick commands) or `exec` with `yieldMs`/`background` → `process` → `poll`/`log`/`write`/`kill` for long runs; use `read`/`write`/`edit`/`apply_patch` for file changes.

---

## Aether-Claw parity

| OpenClaw | Aether-Claw |
|----------|-------------|
| **coding profile** (exec, process, read, write, memory) | ✅ `exec`, `process`, `read_file`, `write_file`, `memory_search` (workspace = project root; exec sync + background sessions). |
| **Tool schema + agent loop** | ✅ OpenRouter tool-calling; loop until no tool_calls or max iterations. |
| **Safety** | ✅ Kill switch and safety gate (SYSTEM_COMMAND, FILE_READ, FILE_WRITE) gating exec and file tools. |
| **group:fs** (read, write, edit, apply_patch) | ✅ `read_file`, `write_file`, `edit` (old_string→new_string), `apply_patch` (unified diff via `patch` command). |
| **group:memory** | ✅ `memory_search` (brain index), `memory_get` (by brain file key). |
| **group:web** | ✅ `web_search` (Brave API; BRAVE_API_KEY), `web_fetch` (URL → text). |
| **group:ui** (browser, canvas) | 🔲 Stubs: `browser`, `canvas`, `nodes` return "not implemented". |
| **group:messaging** | ✅ `message` (action send → Telegram when TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID set). |
| **group:automation** | ✅ `cron` (list/add/remove/run in swarm_config.json cron.jobs), `gateway` (config.get, config.patch; restart stub). |
| **group:sessions** | ✅ `sessions_list`, `sessions_history`, `session_status` (minimal in-memory store); 🔲 `sessions_send`, `sessions_spawn` stubs. |
| **agents_list** | ✅ Returns `["default"]`. |
| **image** | ✅ Vision model via OpenRouter (image_url or image_path + prompt). |

---

## Aether-Claw extras (beyond OpenClaw)

These tools are available in Aether-Claw and are not part of OpenClaw's built-in set. They make the agent more capable for memory, ops, git, and dev workflows.

| Tool | Purpose |
|------|---------|
| **memory_append** | Append text to a brain file (e.g. memory.md) so the agent can "remember this for later". Gated by MEMORY_MODIFICATION. |
| **memory_index** | Reindex brain so new content is searchable (call after memory_append to use new notes in memory_search). |
| **skills_list** | List installed skills with name and signature_valid. |
| **doctor** | Run health checks (config, env, daemon, skills); returns checks with ok, message, fix. |
| **notify** | Send a desktop/system notification (title + message). Gated by NOTIFICATION. |
| **datetime** | Current date, time, timezone (ISO + locale). |
| **list_dir** | List directory contents (names + isFile). Safer than exec ls. |
| **file_exists** | Check if path exists and type (file, dir, none). |
| **kill_switch_status** | Read-only: armed, triggered. |
| **audit_tail** | Read last N entries from brain/audit_log.md. Gated by AUDIT_READ. |
| **git_status** | Short git status (branch, clean/dirty). |
| **git_diff** | Git diff, optionally for a path. |
| **git_log** | Last N commits (oneline). |
| **git_commit** | Stage and commit with message. Gated by GIT_OPERATIONS. |
| **http_request** | Generic HTTP (GET/POST/PUT/DELETE) with optional headers and body. |
| **json_read** | Read JSON file and optional key path (e.g. config.model_routing). |
| **json_write** | Write JSON file; optionally merge at key path. |
| **glob_search** | Find files matching a glob (e.g. **/*.md). |
| **env_get** | Read a safe env var (allowlist: NODE_ENV, LANG, etc.; never secrets). |
| **run_tests** | Run npm test and return pass/fail summary. |
| **lint** | Run eslint and return errors. |
| **skill_invoke** | Stub (not implemented); skills_list available. |

Safety: NOTIFICATION, AUDIT_READ, GIT_OPERATIONS, MEMORY_MODIFICATION are in the safety gate; tools respect kill switch where applicable.

---

## References

- [OpenClaw Tools](https://docs.openclaw.ai/tools)
- [OpenClaw Exec Tool](https://docs.openclaw.ai/tools/exec)
- [OpenClaw Agent Loop](https://docs.openclaw.ai/concepts/agent-loop)
