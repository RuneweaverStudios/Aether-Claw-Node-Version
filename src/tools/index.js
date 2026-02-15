/**
 * Aether-Claw tools (OpenClaw-style): full tool set from OPENCLAW_TOOLS_AND_WORKFLOWS.md.
 * Schemas are OpenAI/OpenRouter function-calling format. Some tools are stubs (browser, canvas, nodes).
 */

const path = require('path');
const fs = require('fs');
const { execSync, spawn, spawnSync } = require('child_process');
const axios = require('axios');
const { searchMemory, readIndex, getBrainDir, indexAll } = require('../brain');
const { checkPermission, ActionCategory } = require('../safety-gate');
const { loadConfig } = require('../config');
const { sendTelegramMessage } = require('../telegram-setup');
const { runChecks } = require('../doctor');
const { send: notifySend } = require('../notifier');

const ROOT_DEFAULT = path.resolve(__dirname, '..', '..');

// In-memory background exec sessions (per-agent key could be passed later)
const backgroundSessions = new Map();
let sessionIdCounter = 0;

function nextSessionId() {
  return 'sess_' + (++sessionIdCounter) + '_' + Date.now();
}

/** OpenAI-format tool definitions for OpenRouter */
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'exec',
      description: 'Run a shell command in the project workspace. Use for running scripts, tests, and shell commands. Returns stdout and stderr. For long-running commands, consider running in background (background: true) and then use process tool to poll. For folders outside the project (e.g. Desktop), you can use create_directory with ~/Desktop/foldername, or exec with a command like: mkdir -p ~/Desktop/foldername.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run (e.g. "npm test", "ls -la")' },
          workdir: { type: 'string', description: 'Working directory relative to project root; default is project root' },
          timeout_seconds: { type: 'number', description: 'Kill command after this many seconds; default 120' },
          background: { type: 'boolean', description: 'If true, run in background and return sessionId for process tool' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Run a shell command (alias for exec). Same parameters as exec.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run' },
          workdir: { type: 'string', description: 'Working directory relative to project root' },
          timeout_seconds: { type: 'number', description: 'Kill after N seconds (default 120)' },
          background: { type: 'boolean', description: 'Run in background' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'process',
      description: 'Manage background exec sessions. Use list to see running sessions, poll to get output and exit status, log to read output, kill to stop.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'poll', 'log', 'kill', 'remove'], description: 'Action to perform' },
          session_id: { type: 'string', description: 'Required for poll, log, kill, remove' },
          offset: { type: 'number', description: 'For log: line offset (omit for last N lines)' },
          limit: { type: 'number', description: 'For log: number of lines (default 100)' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read contents of a file in the project. Path is relative to project root (e.g. "src/index.js", "skills/github/SKILL.md"). Use this to load a skill\'s SKILL.md when the task matches that skill\'s description in the available_skills list.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root (e.g. src/index.js or skills/<skillname>/SKILL.md)' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file in the project. Path is relative to project root. Creates parent directories if needed.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' },
          content: { type: 'string', description: 'Content to write' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_directory',
      description: 'Create a directory. Path can be relative to the project root (must stay inside workspace), or start with ~ for a path under your home (e.g. ~/Desktop/test). Creates parent directories as needed.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path: relative to project root, or ~/... for home-relative (e.g. ~/Desktop/test)' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file. Only files under brain/ can be deleted (e.g. brain/BOOTSTRAP.md to complete the first-run ritual).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root (must be under brain/)' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'memory_search',
      description: 'Search the agent brain memory (indexed notes) for relevant content. Use for recalling past context or user notes.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (keywords)' },
          limit: { type: 'number', description: 'Max number of results (default 5)' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit',
      description: 'Edit a file in-place: replace old_string with new_string. Path relative to project root.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' },
          old_string: { type: 'string', description: 'Exact string to replace (must match exactly)' },
          new_string: { type: 'string', description: 'Replacement string' }
        },
        required: ['path', 'old_string', 'new_string']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'apply_patch',
      description: 'Apply a unified diff patch to the workspace. Patch content should be a valid unified diff. Optional workdir relative to project root.',
      parameters: {
        type: 'object',
        properties: {
          patch_content: { type: 'string', description: 'Unified diff patch content' },
          workdir: { type: 'string', description: 'Working directory relative to project root (default: root)' }
        },
        required: ['patch_content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'memory_get',
      description: 'Get memory content by key (brain file name, e.g. user.md or memory.md). Returns latest version from the index.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Memory key / brain file name (e.g. user.md, memory.md)' }
        },
        required: ['key']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web using Brave Search API. Requires BRAVE_API_KEY in environment.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          count: { type: 'number', description: 'Number of results 1-10 (default 5)' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch URL and return response body as text. Optional maxChars to truncate.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
          maxChars: { type: 'number', description: 'Max characters to return (default 50000)' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser',
      description: 'Browser automation (OpenClaw-managed). In Aether-Claw this is a stub; use exec to run headless browsers if needed.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'status|start|stop|snapshot|screenshot|navigate|open' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'canvas',
      description: 'Local browser canvas: show HTML/URL, take snapshots, run JS. PREFER this over the browser tool for opening URLs (browser is a stub). Actions: present (show url or html), hide (close), navigate (goto url), eval (run JS in page), snapshot (screenshot to path or base64), a2ui_push (set page HTML), a2ui_reset (blank page). Requires: npm install playwright then npx playwright install chromium. Set AETHERCLAW_CANVAS_CHROME=1 to use system Chrome.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['present', 'hide', 'navigate', 'eval', 'snapshot', 'a2ui_push', 'a2ui_reset'],
            description: 'Action: present (show), hide (close), navigate (goto url), eval (run script), snapshot (screenshot), a2ui_push (set HTML), a2ui_reset (blank)'
          },
          url: { type: 'string', description: 'For present or navigate: URL to open' },
          html: { type: 'string', description: 'For present or a2ui_push: HTML content to display' },
          script: { type: 'string', description: 'For eval: JavaScript to run in page context' },
          path: { type: 'string', description: 'For snapshot: optional file path to save PNG (relative to workspace)' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'nodes',
      description: 'Paired nodes (status, notify, run, camera). In Aether-Claw this is a stub; requires OpenClaw node pairing.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'status|describe|notify|run' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'message',
      description: 'Send a message via Telegram. Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env. Use action send with text.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['send'], description: 'Action (send)' },
          text: { type: 'string', description: 'Message text to send' },
          chat_id: { type: 'string', description: 'Optional Telegram chat ID override' }
        },
        required: ['action', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cron',
      description: 'Cron jobs: list, add, remove, run, status. Jobs stored in swarm_config.json under cron.jobs.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'status', 'add', 'remove', 'run'], description: 'Action' },
          job_id: { type: 'string', description: 'Job id for remove/run' },
          schedule: { type: 'string', description: 'Cron expression (e.g. "0 9 * * *") for add' },
          command: { type: 'string', description: 'Shell command for add' },
          label: { type: 'string', description: 'Human-readable label for add' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'gateway',
      description: 'Gateway control: config.get (return config), config.patch (merge JSON and save), restart (stub).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['config.get', 'config.patch', 'restart'], description: 'Action' },
          patch: { type: 'object', description: 'For config.patch: object to merge into swarm_config.json' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sessions_list',
      description: 'List available session keys (e.g. main).',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max sessions to return (default 20)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sessions_history',
      description: 'Get transcript history for a session. Returns recent messages for the given session key.',
      parameters: {
        type: 'object',
        properties: {
          session_key: { type: 'string', description: 'Session key (e.g. main)' },
          limit: { type: 'number', description: 'Max messages to return (default 20)' }
        },
        required: ['session_key']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'session_status',
      description: 'Get current or specified session status (sessionKey, model).',
      parameters: {
        type: 'object',
        properties: {
          session_key: { type: 'string', description: 'Session key (optional, default main)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sessions_send',
      description: 'Send a message to another session. The message is appended to that session\'s history as a user message.',
      parameters: {
        type: 'object',
        properties: {
          session_key: { type: 'string' },
          message: { type: 'string' }
        },
        required: ['session_key', 'message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sessions_spawn',
      description: 'Spawn a sub-agent run: execute the given task in a fresh context and return the reply.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string' },
          label: { type: 'string' }
        },
        required: ['task']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'agents_list',
      description: 'List agent ids that can be targeted (e.g. for sessions_spawn). Aether-Claw returns ["default"].',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'image',
      description: 'Analyze an image with a vision model. Provide image_url (URL) or image_path (project-relative path) and optional prompt.',
      parameters: {
        type: 'object',
        properties: {
          image_url: { type: 'string', description: 'URL of the image' },
          image_path: { type: 'string', description: 'Path to image file relative to project root' },
          prompt: { type: 'string', description: 'Question or prompt for the vision model (default: Describe the image.)' }
        },
        required: []
      }
    }
  },
  { type: 'function', function: { name: 'doctor', description: 'Run health checks (config, env, daemon, skills). Returns checks with ok, message, fix.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'notify', description: 'Send a desktop/system notification (title and message).', parameters: { type: 'object', properties: { title: { type: 'string' }, message: { type: 'string' } }, required: ['title', 'message'] } } },
  { type: 'function', function: { name: 'datetime', description: 'Get current date, time, and timezone.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'list_dir', description: 'List directory contents (names and whether file or dir). Path relative to project root.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory path relative to project root (default .)' } }, required: [] } } },
  { type: 'function', function: { name: 'file_exists', description: 'Check if path exists and type (file, dir, or none).', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'open_in_editor', description: 'Open a folder in Cursor or VS Code. Use this when the user asks to open a project in an editor (e.g. "open newclawnode in vscode" or "open that folder in Cursor"). Path can be absolute or start with ~ (e.g. ~/Desktop/newclawnode). Tries Cursor first, then VS Code.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Folder path: absolute, or ~/Desktop/foldername, or relative to project root' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'cursor_agent_run', description: 'Run the Cursor CLI agent in non-interactive mode on a project. Use when the user wants Cursor to perform a coding task (refactor, fix bug, review, generate commit message, etc.) in a folder. Runs "agent -p \'<prompt>\' --output-format text" with optional --force. Requires Cursor CLI (agent) on PATH. If run hangs, the CLI may need a TTY (suggest tmux in that case).', parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'Task for the Cursor agent (e.g. "Refactor src/utils.js for readability", "Fix the bug in api.js")' }, workdir: { type: 'string', description: 'Project directory relative to workspace root (default: .)' }, timeout_seconds: { type: 'number', description: 'Max seconds to wait (default 180)' }, force: { type: 'boolean', description: 'If true, pass --force to auto-apply changes without confirmation' } }, required: ['prompt'] } } },
  { type: 'function', function: { name: 'cursor_cli_install', description: 'Get Cursor CLI install instructions and add-to-PATH steps, or run the installer. Use when the user asks to install the Cursor CLI, fix "agent: command not found", or put the Cursor agent on PATH. Action: instructions (return install + PATH steps) or install (run official installer, then return PATH steps for current shell).', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['instructions', 'install'], description: 'instructions = return text only; install = run curl installer then return PATH steps' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'memory_append', description: 'Append text to a brain file (e.g. memory.md) so the agent can remember.', parameters: { type: 'object', properties: { file: { type: 'string', description: 'Brain file name (default memory.md)' }, content: { type: 'string' } }, required: ['content'] } } },
  { type: 'function', function: { name: 'memory_index', description: 'Reindex brain so new content is searchable.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'audit_tail', description: 'Read last N entries from the audit log.', parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Max entries (default 20)' } } } } },
  { type: 'function', function: { name: 'git_status', description: 'Short git status (branch, clean/dirty).', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'git_diff', description: 'Git diff, optionally for a path.', parameters: { type: 'object', properties: { path: { type: 'string' } } } } },
  { type: 'function', function: { name: 'git_log', description: 'Last N commits (oneline).', parameters: { type: 'object', properties: { n: { type: 'number', description: 'Number of commits (default 10)' } } } } },
  { type: 'function', function: { name: 'git_commit', description: 'Stage and commit with message.', parameters: { type: 'object', properties: { message: { type: 'string' }, paths: { type: 'array', items: { type: 'string' }, description: 'Optional paths to add (default all)' } }, required: ['message'] } } },
  { type: 'function', function: { name: 'http_request', description: 'Generic HTTP request (GET/POST/PUT/DELETE) with optional headers and body.', parameters: { type: 'object', properties: { url: { type: 'string' }, method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] }, headers: { type: 'object' }, body: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'json_read', description: 'Read JSON file and optionally a key path (e.g. config.model_routing).', parameters: { type: 'object', properties: { path: { type: 'string' }, key_path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'json_write', description: 'Write JSON file; optionally merge at key path.', parameters: { type: 'object', properties: { path: { type: 'string' }, value: { type: 'object' }, key_path: { type: 'string', description: 'Optional dot path to merge into' } }, required: ['path', 'value'] } } },
  { type: 'function', function: { name: 'glob_search', description: 'Find files matching a glob pattern (e.g. **/*.md).', parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'env_get', description: 'Read a safe env var (allowlist: NODE_ENV, LANG, etc.; never secrets).', parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } } },
  { type: 'function', function: { name: 'run_tests', description: 'Run tests (npm test) and return pass/fail summary.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'lint', description: 'Run linter (eslint) and return errors.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'ralph_get_next_story', description: 'Get the next Ralph story to implement. Reads prd.json and returns the highest-priority user story where passes is false, plus the Codebase Patterns section from progress.txt. Use this instead of manually reading prd.json when running the Ralph workflow.', parameters: { type: 'object', properties: { prd_path: { type: 'string', description: 'Path to prd.json relative to workspace (default prd.json)' }, progress_path: { type: 'string', description: 'Path to progress.txt (default progress.txt)' } } } } },
  { type: 'function', function: { name: 'ralph_mark_story_passed', description: 'Mark a user story as passed in the PRD. Sets passes to true for the given story id. Use after successfully implementing a story and passing quality checks.', parameters: { type: 'object', properties: { story_id: { type: 'string', description: 'User story id (e.g. US-001)' }, prd_path: { type: 'string', description: 'Path to prd.json (default prd.json)' } }, required: ['story_id'] } } },
  { type: 'function', function: { name: 'ralph_append_progress', description: 'Append a progress entry to progress.txt. Use after completing a story to record what was done and learnings for future iterations. Content is appended with a timestamp and separator.', parameters: { type: 'object', properties: { content: { type: 'string', description: 'Progress text (implementation summary and learnings)' }, progress_path: { type: 'string', description: 'Path to progress.txt (default progress.txt)' } }, required: ['content'] } } },
  {
    type: 'function',
    function: {
      name: 'github_connect',
      description: 'Check if GitHub CLI (gh) is authenticated, or run GitHub login. Use this when the user asks to connect GitHub, wants to connect Aether-Claw to GitHub, or asks if Aether-Claw is connected to GitHub. Runs gh auth status to check; if not logged in, can run gh auth login (interactive) or return instructions for the user.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['check', 'login'], description: 'check: only report status. login: check then run gh auth login if not connected (interactive in terminal)' },
          run_interactive: { type: 'boolean', description: 'If true and not connected, run gh auth login in this process so user can complete login in terminal (only works when running from a TTY)' }
        },
        required: []
      }
    }
  }
];

function resolvePath(workspaceRoot, relativePath) {
  const p = path.isAbsolute(relativePath) ? relativePath : path.join(workspaceRoot, relativePath);
  const real = path.resolve(p);
  if (!real.startsWith(path.resolve(workspaceRoot))) throw new Error('Path escapes workspace: ' + relativePath);
  return real;
}

function runCreateDirectory(workspaceRoot, args, context) {
  const perm = checkPermission(ActionCategory.FILE_WRITE, null, workspaceRoot);
  if (!perm.allowed) return { error: 'Permission denied: ' + (perm.confirmation_message || 'file_write') };
  const raw = (args.path || '').trim();
  if (!raw) return { error: 'path is required' };
  const home = process.env.HOME || process.env.USERPROFILE || '';
  let resolved;
  if (raw.startsWith('~/') || raw.startsWith('~\\') || raw === '~') {
    if (!home) return { error: 'Home directory not available; use a path relative to project root.' };
    const sub = raw === '~' ? '' : raw.slice(2).replace(/\\/g, path.sep);
    resolved = path.resolve(home, sub);
    const homeReal = path.resolve(home);
    if (!resolved.startsWith(homeReal)) return { error: 'Path must stay under home directory.' };
  } else if (raw.startsWith('$HOME') || raw.startsWith('%USERPROFILE%')) {
    if (!home) return { error: 'Home directory not available.' };
    const sub = raw.replace(/^\$HOME\/?/, '').replace(/^%USERPROFILE%\\?/, '').replace(/\\/g, path.sep);
    resolved = path.resolve(home, sub);
    const homeReal = path.resolve(home);
    if (!resolved.startsWith(homeReal)) return { error: 'Path must stay under home directory.' };
  } else {
    try {
      resolved = resolvePath(workspaceRoot, raw);
    } catch (e) {
      return { error: e.message };
    }
  }
  try {
    fs.mkdirSync(resolved, { recursive: true });
    return { created: resolved };
  } catch (e) {
    return { error: e.message || 'Failed to create directory' };
  }
}

function runExec(workspaceRoot, args, context) {
  const perm = checkPermission(ActionCategory.SYSTEM_COMMAND, null, workspaceRoot);
  if (!perm.allowed) return { error: 'Permission denied: ' + (perm.confirmation_message || 'system_command') };

  const command = args.command;
  const workdir = args.workdir ? resolvePath(workspaceRoot, args.workdir) : workspaceRoot;
  const timeoutSeconds = Math.min(600, Math.max(1, args.timeout_seconds || 120));
  const runBackground = args.background === true;

  if (runBackground) {
    const sessionId = nextSessionId();
    let stdout = '';
    let stderr = '';
    try {
      const child = spawn('sh', ['-c', command], {
        cwd: workdir,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      const timeout = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (e) {}
      }, timeoutSeconds * 1000);
      child.on('close', (code, signal) => {
        clearTimeout(timeout);
        backgroundSessions.set(sessionId, {
          status: 'finished',
          exitCode: code,
          signal,
          stdout,
          stderr,
          finishedAt: new Date().toISOString()
        });
      });
      backgroundSessions.set(sessionId, {
        status: 'running',
        child,
        stdout: () => stdout,
        stderr: () => stderr
      });
      return { status: 'running', sessionId, message: 'Command started in background. Use process tool with action=poll or action=log to get output.' };
    } catch (e) {
      return { error: e.message || String(e) };
    }
  }

  try {
    const out = execSync(command, {
      cwd: workdir,
      encoding: 'utf8',
      timeout: timeoutSeconds * 1000,
      maxBuffer: 2 * 1024 * 1024
    });
    return { stdout: out, stderr: '', exitCode: 0 };
  } catch (e) {
    const stdout = e.stdout != null ? String(e.stdout) : '';
    const stderr = e.stderr != null ? String(e.stderr) : e.message || String(e);
    return { stdout, stderr, exitCode: e.status ?? -1, error: e.message };
  }
}

function runProcess(workspaceRoot, args) {
  const action = args.action;
  if (action === 'list') {
    const entries = [];
    for (const [id, data] of backgroundSessions.entries()) {
      entries.push({
        sessionId: id,
        status: typeof data.status === 'string' ? data.status : (data.child ? 'running' : 'finished'),
        exitCode: data.exitCode
      });
    }
    return { sessions: entries };
  }
  const sessionId = args.session_id;
  if (!sessionId) return { error: 'session_id required for this action' };
  const session = backgroundSessions.get(sessionId);
  if (!session) return { error: 'Session not found: ' + sessionId };

  const getStdout = () => (typeof session.stdout === 'function' ? session.stdout() : session.stdout || '');
  const getStderr = () => (typeof session.stderr === 'function' ? session.stderr() : session.stderr || '');

  if (action === 'poll') {
    if (session.status === 'running') {
      return { status: 'running', stdout: getStdout(), stderr: getStderr() };
    }
    return {
      status: 'finished',
      exitCode: session.exitCode,
      signal: session.signal,
      stdout: getStdout(),
      stderr: getStderr()
    };
  }
  if (action === 'log') {
    const limit = Math.min(500, args.limit || 100);
    const offset = args.offset;
    const text = getStdout() + '\n' + getStderr();
    const lines = text.split('\n');
    const slice = offset != null ? lines.slice(offset, offset + limit) : lines.slice(-limit);
    return { log: slice.join('\n'), lines: slice.length };
  }
  if (action === 'kill') {
    if (session.child) {
      try { session.child.kill('SIGTERM'); } catch (e) {}
      session.status = 'killed';
    }
    return { status: 'killed' };
  }
  if (action === 'remove') {
    backgroundSessions.delete(sessionId);
    return { status: 'removed' };
  }
  return { error: 'Unknown action: ' + action };
}

function runReadFile(workspaceRoot, args, context) {
  const perm = checkPermission(ActionCategory.FILE_READ, null, workspaceRoot);
  if (!perm.allowed) return { error: 'Permission denied: file_read' };
  try {
    const fp = resolvePath(workspaceRoot, args.path);
    const content = fs.readFileSync(fp, 'utf8');
    return { content };
  } catch (e) {
    return { error: e.code === 'ENOENT' ? 'File not found' : e.message };
  }
}

function runWriteFile(workspaceRoot, args, context) {
  const perm = checkPermission(ActionCategory.FILE_WRITE, null, workspaceRoot);
  if (!perm.allowed) return { error: 'Permission denied: file_write' };
  try {
    const fp = resolvePath(workspaceRoot, args.path);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, args.content, 'utf8');
    return { path: args.path, written: true };
  } catch (e) {
    return { error: e.message };
  }
}

function runDeleteFile(workspaceRoot, args, context) {
  const perm = checkPermission(ActionCategory.FILE_WRITE, null, workspaceRoot);
  if (!perm.allowed) return { error: 'Permission denied: file_write' };
  const root = workspaceRoot || ROOT_DEFAULT;
  const brainDir = getBrainDir(root);
  try {
    const fp = resolvePath(root, args.path);
    if (!path.resolve(fp).startsWith(path.resolve(brainDir))) {
      return { error: 'delete_file only allows files under brain/ (e.g. brain/BOOTSTRAP.md)' };
    }
    if (!fs.existsSync(fp)) return { error: 'File not found: ' + args.path };
    if (!fs.statSync(fp).isFile()) return { error: 'Not a file: ' + args.path };
    fs.unlinkSync(fp);
    return { path: args.path, deleted: true };
  } catch (e) {
    return { error: e.message };
  }
}

function runMemorySearch(workspaceRoot, args) {
  const limit = Math.min(20, args.limit || 5);
  const hits = searchMemory(args.query, workspaceRoot, limit);
  return {
    results: hits.map((h) => ({ file: h.file_name, snippet: h.content.slice(0, 300), timestamp: h.timestamp }))
  };
}

function runEdit(workspaceRoot, args, context) {
  const perm = checkPermission(ActionCategory.FILE_WRITE, null, workspaceRoot);
  if (!perm.allowed) return { error: 'Permission denied: file_write' };
  try {
    const fp = resolvePath(workspaceRoot, args.path);
    let content = fs.readFileSync(fp, 'utf8');
    if (!content.includes(args.old_string)) return { error: 'old_string not found in file' };
    content = content.replace(args.old_string, args.new_string);
    fs.writeFileSync(fp, content, 'utf8');
    return { path: args.path, edited: true };
  } catch (e) {
    return { error: e.code === 'ENOENT' ? 'File not found' : e.message };
  }
}

function runApplyPatch(workspaceRoot, args, context) {
  const perm = checkPermission(ActionCategory.FILE_WRITE, null, workspaceRoot);
  if (!perm.allowed) return { error: 'Permission denied: file_write' };
  const workdir = args.workdir ? resolvePath(workspaceRoot, args.workdir) : workspaceRoot;
  const tmp = path.join(workspaceRoot, '.patch_' + Date.now() + '.diff');
  try {
    fs.writeFileSync(tmp, args.patch_content, 'utf8');
    execSync('patch', ['-p0', '--forward', '-i', tmp], { cwd: workdir, encoding: 'utf8', timeout: 30000 });
    return { applied: true, workdir: args.workdir || '.' };
  } catch (e) {
    return { error: e.message || 'Patch failed (ensure patch command exists)' };
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}

function runMemoryGet(workspaceRoot, args) {
  const index = readIndex(workspaceRoot);
  const key = args.key || '';
  const fileData = index.files?.[key] || index.files?.[key.replace(/\.md$/, '')];
  if (!fileData || !fileData.versions?.length) return { error: 'Memory not found for key: ' + key };
  const latest = fileData.versions[fileData.versions.length - 1];
  return { key, content: latest.content || '', timestamp: latest.timestamp };
}

async function runWebSearch(args) {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) return { error: 'BRAVE_API_KEY not set. Set it for web search.' };
  const count = Math.min(10, Math.max(1, args.count || 5));
  try {
    const { data } = await axios.get('https://api.search.brave.com/res/v1/web/search', {
      params: { q: args.query, count },
      headers: { 'X-Subscription-Token': apiKey },
      timeout: 15000
    });
    const results = (data.web?.results || []).map((r) => ({ title: r.title, url: r.url, description: r.description }));
    return { query: args.query, results };
  } catch (e) {
    return { error: e.response?.data?.message || e.message || 'Search failed' };
  }
}

async function runWebFetch(args) {
  const maxChars = Math.min(200000, Math.max(1000, args.maxChars || 50000));
  try {
    const { data } = await axios.get(args.url, { timeout: 20000, responseType: 'text', maxContentLength: maxChars + 10000 });
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    return { url: args.url, content: text.slice(0, maxChars), truncated: text.length > maxChars };
  } catch (e) {
    return { error: e.message || 'Fetch failed' };
  }
}

function runBrowserStub() {
  return { error: 'Browser tool requires Playwright/OpenClaw browser; not implemented in Aether-Claw. Use exec to run headless browsers if needed.' };
}

// Canvas: single browser + page per process (lazy-launched via Playwright)
let canvasBrowser = null;
let canvasPage = null;

async function ensureCanvas(workspaceRoot) {
  if (canvasPage) return null;
  let playwright;
  try {
    playwright = require('playwright');
  } catch (e) {
    return { error: 'Canvas requires Playwright. Install with: npm install playwright then npx playwright install chromium. From repo: npm run install:global to install globally with optional deps.' };
  }
  const useChrome = process.env.AETHERCLAW_CANVAS_CHROME === '1' || process.env.AETHERCLAW_CANVAS_CHROME === 'true';
  const launchOpts = {
    headless: process.env.CI === 'true' || process.env.AETHERCLAW_CANVAS_HEADLESS === '1'
  };
  if (useChrome) {
    launchOpts.channel = 'chrome';
  }
  try {
    canvasBrowser = await playwright.chromium.launch(launchOpts);
    canvasPage = await canvasBrowser.newPage();
    return null;
  } catch (e) {
    const msg = e.message || String(e);
    const hint = msg.includes('Executable doesn\'t exist') || msg.includes('browserType.launch')
      ? ' Run: npx playwright install chromium (or for system Chrome set AETHERCLAW_CANVAS_CHROME=1).'
      : '';
    return { error: 'Canvas launch failed: ' + msg + hint };
  }
}

async function runCanvas(workspaceRoot, args) {
  const root = workspaceRoot || ROOT_DEFAULT;
  const action = args.action;
  if (action === 'hide') {
    if (canvasBrowser) {
      try {
        await canvasBrowser.close();
      } catch (_) {}
      canvasBrowser = null;
      canvasPage = null;
    }
    return { ok: true, message: 'Canvas closed.' };
  }
  if (action === 'present' || action === 'navigate' || action === 'eval' || action === 'snapshot' || action === 'a2ui_push' || action === 'a2ui_reset') {
    const err = await ensureCanvas(root);
    if (err) return err;
  }
  try {
    if (action === 'present') {
      if (args.html) {
        await canvasPage.setContent(args.html, { waitUntil: 'domcontentloaded' });
      } else if (args.url) {
        await canvasPage.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } else {
        await canvasPage.goto('about:blank');
      }
      return { ok: true, message: 'Canvas presented.' };
    }
    if (action === 'navigate') {
      if (!args.url) return { error: 'navigate requires url' };
      await canvasPage.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return { ok: true, message: 'Navigated.' };
    }
    if (action === 'eval') {
      if (!args.script) return { error: 'eval requires script' };
      const result = await canvasPage.evaluate(args.script);
      return { ok: true, result };
    }
    if (action === 'snapshot') {
      const buf = await canvasPage.screenshot({ type: 'png' });
      if (args.path) {
        const outPath = path.isAbsolute(args.path) ? args.path : path.join(root, args.path);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, buf);
        return { ok: true, path: outPath };
      }
      return { ok: true, image_base64: buf.toString('base64') };
    }
    if (action === 'a2ui_push') {
      await canvasPage.setContent(args.html != null ? args.html : '<body></body>', { waitUntil: 'domcontentloaded' });
      return { ok: true, message: 'UI pushed.' };
    }
    if (action === 'a2ui_reset') {
      await canvasPage.goto('about:blank');
      return { ok: true, message: 'Canvas reset.' };
    }
  } catch (e) {
    return { error: 'Canvas action failed: ' + (e.message || String(e)) };
  }
  return { error: 'Unknown canvas action: ' + action };
}

function runNodesStub() {
  return { error: 'Nodes tool requires OpenClaw node pairing; not implemented in Aether-Claw.' };
}

async function runMessage(workspaceRoot, args) {
  if (args.action !== 'send') return { error: 'Only action "send" is supported' };
  require('dotenv').config({ path: path.join(workspaceRoot || ROOT_DEFAULT, '.env') });
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = args.chat_id || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { error: 'TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (or chat_id) required' };
  const ok = await sendTelegramMessage(token, chatId, args.text);
  return ok ? { sent: true } : { error: 'Telegram send failed' };
}

const configPath = (root) => path.join(root, 'swarm_config.json');

function runCron(workspaceRoot, args) {
  const root = workspaceRoot || ROOT_DEFAULT;
  const cfgPath = configPath(root);
  let config;
  try {
    config = loadConfig(cfgPath);
  } catch (e) {
    config = {};
  }
  if (!config.cron) config.cron = { jobs: [] };
  if (!Array.isArray(config.cron.jobs)) config.cron.jobs = [];

  const action = args.action;
  if (action === 'list' || action === 'status') {
    return { jobs: config.cron.jobs.map((j) => ({ id: j.id, schedule: j.schedule, command: j.command, label: j.label })) };
  }
  if (action === 'add') {
    const id = 'job_' + Date.now();
    config.cron.jobs.push({
      id,
      schedule: args.schedule || '0 * * * *',
      command: args.command || '',
      label: args.label || id
    });
    fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf8');
    return { added: true, job_id: id };
  }
  if (action === 'remove') {
    if (!args.job_id) return { error: 'job_id required for remove' };
    config.cron.jobs = config.cron.jobs.filter((j) => j.id !== args.job_id);
    fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf8');
    return { removed: true, job_id: args.job_id };
  }
  if (action === 'run') {
    if (!args.job_id) return { error: 'job_id required for run' };
    const job = config.cron.jobs.find((j) => j.id === args.job_id);
    if (!job) return { error: 'Job not found' };
    try {
      const out = execSync(job.command, { cwd: root, encoding: 'utf8', timeout: 60000 });
      return { ran: true, job_id: args.job_id, stdout: out.slice(0, 2000) };
    } catch (e) {
      return { error: e.message, job_id: args.job_id };
    }
  }
  return { error: 'Unknown cron action' };
}

function runGateway(workspaceRoot, args) {
  const root = workspaceRoot || ROOT_DEFAULT;
  const cfgPath = configPath(root);
  const action = args.action;
  if (action === 'config.get') {
    const config = loadConfig(cfgPath);
    return { config };
  }
  if (action === 'config.patch') {
    if (!args.patch || typeof args.patch !== 'object') return { error: 'patch object required' };
    let config;
    try {
      config = loadConfig(cfgPath);
    } catch (e) {
      config = {};
    }
    const merged = deepMerge(config, args.patch);
    fs.writeFileSync(cfgPath, JSON.stringify(merged, null, 2), 'utf8');
    return { applied: true };
  }
  if (action === 'restart') {
    return { error: 'Restart not available in this context; restart the daemon externally.' };
  }
  return { error: 'Unknown gateway action' };
}

function deepMerge(target, src) {
  const out = { ...target };
  for (const k of Object.keys(src)) {
    if (src[k] != null && typeof src[k] === 'object' && !Array.isArray(src[k])) {
      out[k] = deepMerge(out[k] || {}, src[k]);
    } else {
      out[k] = src[k];
    }
  }
  return out;
}

// In-memory session store for sessions_list / sessions_history / session_status (minimal)
const sessionStore = new Map();
const SESSION_MAIN = 'main';
function getSessionHistory(sessionKey, limit = 20) {
  const list = sessionStore.get(sessionKey) || [];
  return list.slice(-limit);
}
function pushSessionMessage(sessionKey, role, content) {
  const list = sessionStore.get(sessionKey) || [];
  list.push({ role, content, at: new Date().toISOString() });
  if (list.length > 100) list.splice(0, list.length - 50);
  sessionStore.set(sessionKey, list);
}

function clearSession(sessionKey) {
  sessionStore.set(sessionKey, []);
}

function runSessionsList(args) {
  const limit = Math.min(50, args.limit || 20);
  const keys = Array.from(sessionStore.keys());
  if (keys.length === 0) keys.push(SESSION_MAIN);
  return { sessions: [...new Set(keys)].slice(0, limit) };
}

function runSessionsHistory(workspaceRoot, args) {
  const key = args.session_key || SESSION_MAIN;
  const limit = Math.min(50, args.limit || 20);
  const messages = getSessionHistory(key, limit);
  return { session_key: key, messages };
}

function runSessionStatus(workspaceRoot, args) {
  const config = loadConfig(configPath(workspaceRoot || ROOT_DEFAULT));
  return {
    session_key: args.session_key || SESSION_MAIN,
    model: config.model_routing?.tier_1_reasoning?.model || 'default'
  };
}

function runSessionsSend(args) {
  const key = args.session_key || SESSION_MAIN;
  const msg = args.message || '';
  if (!msg) return { error: 'message is required' };
  pushSessionMessage(key, 'user', msg);
  return { sent: true, session_key: key };
}

async function runSessionsSpawn(workspaceRoot, args, context) {
  const task = args.task || '';
  if (!task) return { error: 'task is required' };
  const root = workspaceRoot || ROOT_DEFAULT;
  try {
    const { buildSystemPromptForRun } = require('../gateway');
    const { runAgentLoop } = require('../agent-loop');
    const config = loadConfig(configPath(root));
    const systemPrompt = buildSystemPromptForRun(root);
    const result = await runAgentLoop(root, task, systemPrompt, config, { conversationHistory: [], maxIterations: 10 });
    if (result.error && !result.reply) return { error: result.error };
    return { reply: result.reply || '', tool_calls_count: result.toolCallsCount };
  } catch (e) {
    return { error: e.message || 'sessions_spawn failed' };
  }
}

function runAgentsList() {
  return { agents: ['default'] };
}

async function runImage(workspaceRoot, args, context) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { error: 'OPENROUTER_API_KEY not set' };
  let imageUrl = args.image_url;
  if (!imageUrl && args.image_path) {
    const fp = resolvePath(workspaceRoot || ROOT_DEFAULT, args.image_path);
    if (!fs.existsSync(fp)) return { error: 'Image file not found' };
    const buf = fs.readFileSync(fp);
    const base64 = buf.toString('base64');
    const ext = path.extname(fp).toLowerCase() || '.png';
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : 'image/png';
    imageUrl = `data:${mime};base64,${base64}`;
  }
  if (!imageUrl) return { error: 'Provide image_url or image_path' };
  const prompt = args.prompt || 'Describe the image.';
  const model = (context.config?.model_routing?.tier_1_reasoning?.model) || 'anthropic/claude-sonnet-4';
  try {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }] }
    ];
    const { data } = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      { model, messages, max_tokens: 1024 },
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, timeout: 60000 }
    );
    const text = data.choices?.[0]?.message?.content;
    return text ? { description: text } : { error: 'No response from vision model' };
  } catch (e) {
    return { error: e.response?.data?.error?.message || e.message || 'Vision call failed' };
  }
}

function runDoctor(workspaceRoot) {
  const results = runChecks();
  const has_failures = results.some((r) => !r.ok);
  return { checks: results, has_failures };
}

function runNotify(workspaceRoot, args, context) {
  const perm = checkPermission(ActionCategory.NOTIFICATION, null, workspaceRoot);
  if (!perm.allowed) return { error: 'Permission denied: notification' };
  try {
    notifySend(args.title || 'Aether-Claw', args.message || '', 'info', 10, workspaceRoot || ROOT_DEFAULT);
    return { sent: true };
  } catch (e) {
    return { error: e.message };
  }
}

function runDatetime() {
  const d = new Date();
  return {
    iso: d.toISOString(),
    timezone_offset: d.getTimezoneOffset(),
    locale_string: d.toLocaleString()
  };
}

function runListDir(workspaceRoot, args) {
  const root = workspaceRoot || ROOT_DEFAULT;
  const dirPath = args.path ? resolvePath(root, args.path) : root;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return { entries: entries.map((e) => ({ name: e.name, isFile: e.isFile() })) };
  } catch (e) {
    return { error: e.code === 'ENOENT' ? 'Directory not found' : e.message };
  }
}

function runFileExists(workspaceRoot, args) {
  const root = workspaceRoot || ROOT_DEFAULT;
  try {
    const fp = resolvePath(root, args.path);
    if (!fs.existsSync(fp)) return { exists: false, type: 'none' };
    const stat = fs.statSync(fp);
    return { exists: true, type: stat.isFile() ? 'file' : stat.isDirectory() ? 'dir' : 'other' };
  } catch (e) {
    return { exists: false, type: 'none', error: e.message };
  }
}

/** Resolve folder path for open_in_editor: ~/..., absolute, or relative to workspace. */
function resolveFolderPath(workspaceRoot, rawPath) {
  const raw = (rawPath || '').trim();
  if (!raw) return { error: 'path is required' };
  const home = process.env.HOME || process.env.USERPROFILE || '';
  let resolved;
  if (raw.startsWith('~/') || raw.startsWith('~\\') || raw === '~') {
    if (!home) return { error: 'Home directory not available' };
    const sub = raw === '~' ? '' : raw.slice(2).replace(/\\/g, path.sep);
    resolved = path.resolve(home, sub);
  } else if (path.isAbsolute(raw)) {
    resolved = path.resolve(raw);
  } else {
    try {
      resolved = resolvePath(workspaceRoot, raw);
    } catch (e) {
      return { error: e.message };
    }
  }
  return { resolved };
}

function runOpenInEditor(workspaceRoot, args, context) {
  const perm = checkPermission(ActionCategory.SYSTEM_COMMAND, null, workspaceRoot || ROOT_DEFAULT);
  if (!perm.allowed) return { error: 'Permission denied: ' + (perm.confirmation_message || 'system_command') };
  const r = resolveFolderPath(workspaceRoot || ROOT_DEFAULT, args.path);
  if (r.error) return { error: r.error };
  const dir = r.resolved;
  try {
    if (!fs.existsSync(dir)) return { error: 'Folder not found: ' + dir };
    if (!fs.statSync(dir).isDirectory()) return { error: 'Not a directory: ' + dir };
  } catch (e) {
    return { error: e.message || 'Invalid path' };
  }
  const opts = { detached: true, stdio: 'ignore' };
  const tryRun = (cmd, argv) => {
    try {
      spawn(cmd, argv, opts).unref();
      return true;
    } catch (e) {
      return false;
    }
  };
  if (tryRun('cursor', [dir])) return { opened: true, editor: 'cursor', path: dir };
  if (tryRun('code', [dir])) return { opened: true, editor: 'vscode', path: dir };
  if (process.platform === 'darwin') {
    if (tryRun('open', ['-a', 'Cursor', dir])) return { opened: true, editor: 'cursor', path: dir };
    if (tryRun('open', ['-a', 'Visual Studio Code', dir])) return { opened: true, editor: 'vscode', path: dir };
  }
  return {
    error: 'Could not open in editor: cursor and code commands not found.',
    path: dir,
    hint: 'Open Cursor or VS Code, then use File → Open Folder and choose: ' + dir
  };
}

/** Escape a string for safe use inside single-quoted shell argument. */
function shellEscapeSingleQuoted(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

/** Return the first Cursor CLI binary found on PATH, or null. Avoids running a command that doesn't exist. */
function whichAgent() {
  const bins = ['agent', 'cursor-agent'];
  const check = process.platform === 'win32' ? (b) => `where ${b}` : (b) => `command -v ${b} || which ${b}`;
  for (const bin of bins) {
    try {
      execSync(check(bin), { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      return bin;
    } catch (_) {}
  }
  return null;
}

function runCursorAgentRun(workspaceRoot, args, context) {
  const perm = checkPermission(ActionCategory.SYSTEM_COMMAND, null, workspaceRoot || ROOT_DEFAULT);
  if (!perm.allowed) return { error: 'Permission denied: ' + (perm.confirmation_message || 'system_command') };
  const root = workspaceRoot || ROOT_DEFAULT;
  const workdir = args.workdir ? resolvePath(root, args.workdir) : root;
  const prompt = (args.prompt || '').trim();
  if (!prompt) return { error: 'prompt is required' };

  const bin = whichAgent();
  if (!bin) {
    return {
      error: 'Cursor CLI (agent) not found on PATH.',
      hint: 'Install with: curl https://cursor.com/install -fsS | bash ; then run "agent login". To work in Cursor without the CLI, use the open_in_editor tool with path: ' + workdir,
      workdir,
      suggest_open_in_editor: true
    };
  }

  const timeoutSeconds = Math.min(600, Math.max(30, args.timeout_seconds || 180));
  const forceFlag = args.force === true ? ' --force' : '';
  const agentCmd = shellEscapeSingleQuoted(prompt);
  const buildCmd = (b) => `${b} -p ${agentCmd} --output-format text${forceFlag}`;
  let out;
  try {
    out = execSync(buildCmd(bin), {
      cwd: workdir,
      encoding: 'utf8',
      timeout: timeoutSeconds * 1000,
      maxBuffer: 4 * 1024 * 1024
    });
    return { stdout: (out || '').trim(), stderr: '', exitCode: 0, workdir };
  } catch (err) {
    const e = err;
    const stdout = e.stdout != null ? String(e.stdout) : '';
    const stderr = e.stderr != null ? String(e.stderr) : '';
    const timedOut = e.killed === true || (e.message && e.message.includes('ETIMEDOUT'));
    const error = timedOut
      ? 'Cursor agent run timed out or hung.'
      : (e.message || String(e));
    const hint = timedOut
      ? 'The Cursor CLI often requires a real TTY when run from scripts. Try running in a terminal with tmux, or use open_in_editor to open the project in Cursor and run the task there.'
      : undefined;
    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: e.status ?? -1,
      error,
      hint: hint || undefined
    };
  }
}

const CURSOR_CLI_INSTRUCTIONS = `Install Cursor CLI (adds \`agent\` to PATH):

1. Run the official installer:
   curl https://cursor.com/install -fsS | bash

2. Add ~/.local/bin to your PATH (installer puts \`agent\` there):

   For zsh (default on macOS):
   echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
   source ~/.zshrc

   For bash:
   echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
   source ~/.bashrc

3. In a new terminal (or after sourcing): agent --version
4. Log in once: agent login

Then cursor_agent_run will work.`;

function runCursorCliInstall(workspaceRoot, args, context) {
  const perm = checkPermission(ActionCategory.SYSTEM_COMMAND, null, workspaceRoot || ROOT_DEFAULT);
  if (!perm.allowed) return { error: 'Permission denied: system_command' };
  const action = (args.action || 'instructions').toLowerCase();
  if (action === 'instructions') {
    return { ok: true, instructions: CURSOR_CLI_INSTRUCTIONS, path_add: 'export PATH="$HOME/.local/bin:$PATH"' };
  }
  if (action === 'install') {
    try {
      execSync('curl https://cursor.com/install -fsS | bash', {
        stdio: 'inherit',
        timeout: 120000,
        shell: true
      });
      const pathAdd = process.platform === 'win32'
        ? 'set PATH=%USERPROFILE%\\.local\\bin;%PATH%'
        : 'export PATH="$HOME/.local/bin:$PATH"';
      const shellRc = process.env.SHELL && process.env.SHELL.includes('zsh') ? '~/.zshrc' : '~/.bashrc';
      return {
        ok: true,
        message: 'Cursor CLI installed. Add to PATH and reload shell.',
        path_add: pathAdd,
        next_step: `Add to ${shellRc}: echo 'export PATH="$HOME/.local/bin:$PATH"' >> ${shellRc} ; source ${shellRc}`,
        instructions: CURSOR_CLI_INSTRUCTIONS
      };
    } catch (e) {
      return {
        error: 'Cursor CLI install failed: ' + (e.message || String(e)),
        instructions: CURSOR_CLI_INSTRUCTIONS
      };
    }
  }
  return { error: 'Unknown action: use instructions or install' };
}

function runMemoryAppend(workspaceRoot, args, context) {
  const perm = checkPermission(ActionCategory.MEMORY_MODIFICATION, null, workspaceRoot);
  if (!perm.allowed) return { error: 'Permission denied: memory_modification' };
  const root = workspaceRoot || ROOT_DEFAULT;
  const brainDir = getBrainDir(root);
  const file = (args.file || 'memory.md').replace(/\.\./g, '');
  const fp = path.join(brainDir, file.endsWith('.md') ? file : file + '.md');
  if (!path.resolve(fp).startsWith(path.resolve(brainDir))) return { error: 'Invalid brain file' };
  try {
    const existing = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
    const sep = existing.endsWith('\n') ? '' : '\n';
    fs.writeFileSync(fp, existing + sep + args.content + '\n', 'utf8');
    return { appended: true, file: path.basename(fp) };
  } catch (e) {
    return { error: e.message };
  }
}

function runMemoryIndex(workspaceRoot, context) {
  const perm = checkPermission(ActionCategory.FILE_READ, null, workspaceRoot);
  if (!perm.allowed) return { error: 'Permission denied: file_read' };
  try {
    const results = indexAll(workspaceRoot || ROOT_DEFAULT);
    return { indexed: Object.keys(results), count: Object.keys(results).length };
  } catch (e) {
    return { error: e.message };
  }
}

function runAuditTail(workspaceRoot, args, context) {
  const perm = checkPermission(ActionCategory.AUDIT_READ, null, workspaceRoot);
  if (!perm.allowed) return { error: 'Permission denied: audit_read' };
  const root = workspaceRoot || ROOT_DEFAULT;
  const auditPath = path.join(root, 'brain', 'audit_log.md');
  try {
    if (!fs.existsSync(auditPath)) return { entries: [] };
    const raw = fs.readFileSync(auditPath, 'utf8');
    const limit = Math.min(50, args.limit || 20);
    const blocks = raw.split(/\n### /).filter((b) => b.trim());
    const entries = blocks.slice(-limit).map((b) => b.slice(0, 500));
    return { entries };
  } catch (e) {
    return { error: e.message };
  }
}

function runGitStatus(workspaceRoot) {
  const root = workspaceRoot || ROOT_DEFAULT;
  try {
    const out = execSync('git', ['status', '-sb'], { cwd: root, encoding: 'utf8', timeout: 5000 });
    return { status: out.trim() };
  } catch (e) {
    return { error: e.message || 'Not a git repo' };
  }
}

function runGitDiff(workspaceRoot, args) {
  const root = workspaceRoot || ROOT_DEFAULT;
  try {
    const argv = ['diff'];
    if (args.path) argv.push('--', args.path);
    const out = execSync('git', argv, { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
    return { diff: out.slice(0, 15000), truncated: out.length > 15000 };
  } catch (e) {
    return { error: e.message || 'Git diff failed' };
  }
}

function runGitLog(workspaceRoot, args) {
  const root = workspaceRoot || ROOT_DEFAULT;
  const n = Math.min(50, args.n || 10);
  try {
    const out = execSync('git', ['log', '-n', String(n), '--oneline'], { cwd: root, encoding: 'utf8', timeout: 5000 });
    return { log: out.trim().split('\n') };
  } catch (e) {
    return { error: e.message || 'Not a git repo' };
  }
}

function runGitCommit(workspaceRoot, args, context) {
  const perm = checkPermission(ActionCategory.GIT_OPERATIONS, null, workspaceRoot);
  if (!perm.allowed) return { error: 'Permission denied: git_operations' };
  const root = workspaceRoot || ROOT_DEFAULT;
  try {
    if (args.paths && args.paths.length) {
      execSync('git', ['add', ...args.paths], { cwd: root, encoding: 'utf8' });
    } else {
      execSync('git', ['add', '-A'], { cwd: root, encoding: 'utf8' });
    }
    execSync('git', ['commit', '-m', args.message], { cwd: root, encoding: 'utf8' });
    return { committed: true };
  } catch (e) {
    return { error: e.message || 'Git commit failed' };
  }
}

async function runHttpRequest(args) {
  const method = (args.method || 'GET').toUpperCase();
  const maxBody = 100000;
  try {
    const config = { method, timeout: 20000, responseType: 'text', maxContentLength: maxBody + 10000 };
    if (args.headers && Object.keys(args.headers).length) config.headers = args.headers;
    if (args.body && ['POST', 'PUT', 'PATCH'].includes(method)) config.data = args.body;
    const { data, status } = await axios(args.url, config);
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    return { status, body: text.slice(0, maxBody), truncated: text.length > maxBody };
  } catch (e) {
    return { error: e.response ? `${e.response.status}: ${e.message}` : e.message };
  }
}

function runJsonRead(workspaceRoot, args, context) {
  const perm = checkPermission(ActionCategory.FILE_READ, null, workspaceRoot);
  if (!perm.allowed) return { error: 'Permission denied: file_read' };
  try {
    const fp = resolvePath(workspaceRoot || ROOT_DEFAULT, args.path);
    const raw = fs.readFileSync(fp, 'utf8');
    let value = JSON.parse(raw);
    if (args.key_path) {
      for (const k of args.key_path.split('.')) value = value?.[k];
    }
    return { value };
  } catch (e) {
    return { error: e.code === 'ENOENT' ? 'File not found' : e.message };
  }
}

function runJsonWrite(workspaceRoot, args, context) {
  const perm = checkPermission(ActionCategory.FILE_WRITE, null, workspaceRoot);
  if (!perm.allowed) return { error: 'Permission denied: file_write' };
  try {
    const fp = resolvePath(workspaceRoot || ROOT_DEFAULT, args.path);
    if (args.key_path) {
      let current = {};
      if (fs.existsSync(fp)) current = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const keys = args.key_path.split('.');
      let target = current;
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        if (!(k in target) || typeof target[k] !== 'object') target[k] = {};
        target = target[k];
      }
      target[keys[keys.length - 1]] = args.value;
      fs.writeFileSync(fp, JSON.stringify(current, null, 2), 'utf8');
    } else {
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, JSON.stringify(args.value, null, 2), 'utf8');
    }
    return { written: true, path: args.path };
  } catch (e) {
    return { error: e.message };
  }
}

function runGlobSearch(workspaceRoot, args) {
  const root = workspaceRoot || ROOT_DEFAULT;
  const pattern = args.pattern || '**/*';
  const parts = pattern.split('*').filter(Boolean);
  const results = [];
  function walk(dir, depth) {
    if (depth > 20) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const rel = path.relative(root, path.join(dir, e.name));
        const match = simpleGlobMatch(rel, pattern);
        if (e.isFile() && match) results.push(rel);
        if (e.isDirectory() && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth + 1);
      }
    } catch (err) {}
  }
  walk(root, 0);
  return { files: results.slice(0, 200) };
}

function simpleGlobMatch(filePath, pattern) {
  const re = new RegExp('^' + pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\./g, '\\.') + '$');
  return re.test(filePath);
}

const ENV_ALLOWLIST = ['NODE_ENV', 'LANG', 'LC_ALL', 'TZ', 'PWD', 'USER', 'HOME', 'EDITOR', 'SHELL'];

function runEnvGet(args) {
  const key = args.key || '';
  if (!ENV_ALLOWLIST.includes(key)) return { error: 'Key not in allowlist (safe vars only)' };
  const value = process.env[key];
  return { key, value: value != null ? value : null, set: value != null };
}

function runRunTests(workspaceRoot) {
  const root = workspaceRoot || ROOT_DEFAULT;
  try {
    const out = execSync('npm', ['test'], { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
    const str = out.slice(-8000);
    const passed = /(\d+) passing/.exec(str);
    const failed = /(\d+) failing/.exec(str);
    return {
      passed: passed ? parseInt(passed[1], 10) : (out.includes('pass') ? 1 : 0),
      failed: failed ? parseInt(failed[1], 10) : 0,
      output_summary: str.slice(-2000)
    };
  } catch (e) {
    return { error: e.message, output_summary: (e.stdout || e.stderr || '').slice(-2000) };
  }
}

function runLint(workspaceRoot) {
  const root = workspaceRoot || ROOT_DEFAULT;
  try {
    const out = execSync('npx', ['eslint', '.', '--format', 'compact'], { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
    const lines = out.trim().split('\n').filter((l) => l.includes(':'));
    const errors = lines.slice(0, 50).map((l) => {
      const m = l.match(/^(.+): line (\d+), col \d+, (.+)$/);
      return m ? { file: m[1], line: parseInt(m[2], 10), message: m[3] } : { raw: l };
    });
    return { errors };
  } catch (e) {
    const out = (e.stdout || e.stderr || '').trim();
    const lines = out.split('\n').filter((l) => l.includes(':'));
    return { errors: lines.slice(0, 50).map((l) => ({ raw: l })), error: e.message };
  }
}

function runRalphGetNextStory(workspaceRoot, args) {
  const root = workspaceRoot || ROOT_DEFAULT;
  const prdPath = args.prd_path || 'prd.json';
  const progressPath = args.progress_path || 'progress.txt';
  try {
    const prdFp = path.isAbsolute(prdPath) ? prdPath : path.join(root, prdPath);
    if (!fs.existsSync(prdFp)) return { error: 'prd.json not found at ' + prdPath };
    const prd = JSON.parse(fs.readFileSync(prdFp, 'utf8'));
    const stories = prd.userStories || [];
    const next = stories
      .filter((s) => s.passes === false)
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))[0];
    let codebasePatterns = '';
    const progressFp = path.isAbsolute(progressPath) ? progressPath : path.join(root, progressPath);
    if (fs.existsSync(progressFp)) {
      const content = fs.readFileSync(progressFp, 'utf8');
      const match = content.match(/## Codebase Patterns[\s\S]*?(?=## |$)/i);
      if (match) codebasePatterns = match[0].trim();
    }
    if (!next) {
      return { all_complete: true, message: 'All user stories have passes: true.', codebasePatterns: codebasePatterns || '(none)' };
    }
    return { story: next, codebasePatterns: codebasePatterns || '(none)', branchName: prd.branchName, project: prd.project };
  } catch (e) {
    return { error: e.message || 'ralph_get_next_story failed' };
  }
}

function runRalphMarkStoryPassed(workspaceRoot, args, context) {
  const root = workspaceRoot || ROOT_DEFAULT;
  const perm = checkPermission(ActionCategory.FILE_WRITE, null, root);
  if (!perm.allowed) return { error: 'Permission denied: file_write' };
  const storyId = args.story_id;
  const prdPath = args.prd_path || 'prd.json';
  try {
    const prdFp = path.isAbsolute(prdPath) ? prdPath : path.join(root, prdPath);
    if (!fs.existsSync(prdFp)) return { error: 'prd.json not found at ' + prdPath };
    const prd = JSON.parse(fs.readFileSync(prdFp, 'utf8'));
    const stories = prd.userStories || [];
    const idx = stories.findIndex((s) => s.id === storyId);
    if (idx === -1) return { error: 'Story not found: ' + storyId };
    stories[idx].passes = true;
    prd.userStories = stories;
    fs.writeFileSync(prdFp, JSON.stringify(prd, null, 2), 'utf8');
    return { ok: true, story_id: storyId };
  } catch (e) {
    return { error: e.message || 'ralph_mark_story_passed failed' };
  }
}

function runRalphAppendProgress(workspaceRoot, args, context) {
  const root = workspaceRoot || ROOT_DEFAULT;
  const perm = checkPermission(ActionCategory.FILE_WRITE, null, root);
  if (!perm.allowed) return { error: 'Permission denied: file_write' };
  const content = args.content;
  const progressPath = args.progress_path || 'progress.txt';
  try {
    const progressFp = path.isAbsolute(progressPath) ? progressPath : path.join(root, progressPath);
    const timestamp = new Date().toISOString();
    const block = `\n## ${timestamp}\n${content}\n---\n`;
    fs.appendFileSync(progressFp, block, 'utf8');
    return { ok: true, appended: true };
  } catch (e) {
    return { error: e.message || 'ralph_append_progress failed' };
  }
}

const GITHUB_CONNECT_INSTRUCTIONS = [
  'To connect GitHub:',
  '  1. In your terminal run: gh auth login',
  '  2. Choose GitHub.com (or your host), then HTTPS or SSH.',
  '  3. Complete the flow (browser or paste a token).',
  '  4. Then ask again "am I connected to GitHub?" to confirm.'
].join('\n');

function runGithubConnect(workspaceRoot, args) {
  const action = args.action || 'check';
  const runInteractive = args.run_interactive === true;
  try {
    const statusOut = execSync('gh auth status', {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return {
      connected: true,
      message: 'GitHub CLI is authenticated. Aether-Claw can use gh for Git operations.',
      details: statusOut.trim()
    };
  } catch (e) {
    if (e.code === 'ENOENT') {
      return {
        connected: false,
        error: 'GitHub CLI (gh) is not installed.',
        instructions: 'Install gh: https://cli.github.com/ — e.g. on macOS: brew install gh. Then run: gh auth login'
      };
    }
    const stderr = (e.stderr || e.message || '').toString();
    const notLoggedIn = e.status !== 0 || stderr.toLowerCase().includes('not logged in');
    if (!notLoggedIn) {
      return { error: stderr.trim() || 'gh auth status failed' };
    }
    const shouldRunLogin = action === 'login' && (runInteractive || process.stdin.isTTY);
    if (shouldRunLogin && process.stdin.isTTY) {
      try {
        const result = spawnSync('gh', ['auth', 'login'], {
          stdio: 'inherit',
          cwd: workspaceRoot || ROOT_DEFAULT
        });
        if (result.status === 0) {
          const out = execSync('gh auth status', { encoding: 'utf8', timeout: 5000 });
          return {
            connected: true,
            message: 'GitHub login completed. You are now connected.',
            details: out.trim(),
            instructions: GITHUB_CONNECT_INSTRUCTIONS
          };
        }
        return {
          connected: false,
          message: 'gh auth login exited without completing. You can try again or run it manually in your terminal.',
          instructions: GITHUB_CONNECT_INSTRUCTIONS
        };
      } catch (err) {
        return {
          connected: false,
          error: err.message || 'gh auth login failed',
          instructions: GITHUB_CONNECT_INSTRUCTIONS
        };
      }
    }
    return {
      connected: false,
      message: 'GitHub is not connected. Aether-Claw uses the GitHub CLI (gh) for authentication.',
      instructions: GITHUB_CONNECT_INSTRUCTIONS
    };
  }
}

/**
 * Execute a single tool by name with parsed arguments. Async for network/Telegram/vision tools.
 * @param {string} workspaceRoot - Project root path
 * @param {string} toolName - Tool name (exec, process, read_file, write_file, memory_search, edit, apply_patch, memory_get, web_search, web_fetch, browser, canvas, nodes, message, cron, gateway, sessions_*, agents_list, image, open_in_editor, github_connect, ...)
 * @param {Object} args - Tool arguments (from LLM)
 * @param {Object} context - { config }
 * @returns {Promise<Object>} Result to send back to the model (will be JSON.stringify'd)
 */
async function runTool(workspaceRoot, toolName, args, context = {}) {
  const root = workspaceRoot || ROOT_DEFAULT;
  const ctx = context;

  switch (toolName) {
    case 'exec':
    case 'bash':
      return runExec(root, args, ctx);
    case 'process':
      return runProcess(root, args);
    case 'read_file':
      return runReadFile(root, args, ctx);
    case 'write_file':
      return runWriteFile(root, args, ctx);
    case 'create_directory':
      return runCreateDirectory(root, args, ctx);
    case 'delete_file':
      return runDeleteFile(root, args, ctx);
    case 'memory_search':
      return runMemorySearch(root, args);
    case 'edit':
      return runEdit(root, args, ctx);
    case 'apply_patch':
      return runApplyPatch(root, args, ctx);
    case 'memory_get':
      return runMemoryGet(root, args);
    case 'web_search':
      return await runWebSearch(args);
    case 'web_fetch':
      return await runWebFetch(args);
    case 'browser':
      return runBrowserStub();
    case 'canvas':
      return await runCanvas(root, args);
    case 'nodes':
      return runNodesStub();
    case 'message':
      return await runMessage(root, args);
    case 'cron':
      return runCron(root, args);
    case 'gateway':
      return runGateway(root, args);
    case 'sessions_list':
      return runSessionsList(args);
    case 'sessions_history':
      return runSessionsHistory(root, args);
    case 'session_status':
      return runSessionStatus(root, args);
    case 'sessions_send':
      return runSessionsSend(args);
    case 'sessions_spawn':
      return await runSessionsSpawn(root, args, ctx);
    case 'agents_list':
      return runAgentsList();
    case 'image':
      return await runImage(root, args, ctx);
    case 'doctor':
      return runDoctor(root);
    case 'notify':
      return runNotify(root, args, ctx);
    case 'datetime':
      return runDatetime();
    case 'list_dir':
      return runListDir(root, args);
    case 'file_exists':
      return runFileExists(root, args);
    case 'open_in_editor':
      return runOpenInEditor(root, args, ctx);
    case 'cursor_agent_run':
      return runCursorAgentRun(root, args, ctx);
    case 'cursor_cli_install':
      return runCursorCliInstall(root, args, ctx);
    case 'memory_append':
      return runMemoryAppend(root, args, ctx);
    case 'memory_index':
      return runMemoryIndex(root, ctx);
    case 'audit_tail':
      return runAuditTail(root, args, ctx);
    case 'git_status':
      return runGitStatus(root);
    case 'git_diff':
      return runGitDiff(root, args);
    case 'git_log':
      return runGitLog(root, args);
    case 'git_commit':
      return runGitCommit(root, args, ctx);
    case 'http_request':
      return await runHttpRequest(args);
    case 'json_read':
      return runJsonRead(root, args, ctx);
    case 'json_write':
      return runJsonWrite(root, args, ctx);
    case 'glob_search':
      return runGlobSearch(root, args);
    case 'env_get':
      return runEnvGet(args);
    case 'run_tests':
      return runRunTests(root);
    case 'lint':
      return runLint(root);
    case 'ralph_get_next_story':
      return runRalphGetNextStory(root, args);
    case 'ralph_mark_story_passed':
      return runRalphMarkStoryPassed(root, args, ctx);
    case 'ralph_append_progress':
      return runRalphAppendProgress(root, args, ctx);
    case 'github_connect':
      return runGithubConnect(root, args);
    default:
      return { error: 'Unknown tool: ' + toolName };
  }
}

module.exports = {
  TOOL_DEFINITIONS,
  runTool,
  runExec,
  runProcess,
  runReadFile,
  runWriteFile,
  runMemorySearch,
  pushSessionMessage,
  getSessionHistory,
  clearSession,
  SESSION_MAIN
};
