/**
 * Aether-Claw tools (OpenClaw-style): full tool set from OPENCLAW_TOOLS_AND_WORKFLOWS.md.
 * Schemas are OpenAI/OpenRouter function-calling format. Some tools are stubs (browser, canvas, nodes).
 */

const path = require('path');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
const axios = require('axios');
const { searchMemory, readIndex } = require('../brain');
const { getKillSwitch } = require('../kill-switch');
const { checkPermission, ActionCategory } = require('../safety-gate');
const { loadConfig } = require('../config');
const { sendTelegramMessage } = require('../telegram-setup');

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
      description: 'Run a shell command in the project workspace. Use for running scripts, tests, and shell commands. Returns stdout and stderr. For long-running commands, consider running in background (background: true) and then use process tool to poll.',
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
      description: 'Read contents of a file in the project. Path is relative to project root.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root (e.g. "src/index.js")' }
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
      description: 'Node Canvas (present, snapshot, a2ui). In Aether-Claw this is a stub; requires OpenClaw node connection.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'present|hide|snapshot' }
        }
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
      description: 'Send a message to another session. Stub in Aether-Claw.',
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
      description: 'Spawn a sub-agent run. Stub in Aether-Claw.',
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
  }
];

function resolvePath(workspaceRoot, relativePath) {
  const p = path.isAbsolute(relativePath) ? relativePath : path.join(workspaceRoot, relativePath);
  const real = path.resolve(p);
  if (!real.startsWith(path.resolve(workspaceRoot))) throw new Error('Path escapes workspace: ' + relativePath);
  return real;
}

function runExec(workspaceRoot, args, context) {
  const { killSwitch, config } = context || {};
  if (killSwitch && killSwitch.isTriggered()) return { error: 'Kill switch is triggered; exec disabled.' };
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
  const { killSwitch } = context || {};
  if (killSwitch && killSwitch.isTriggered()) return { error: 'Kill switch triggered' };
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
  const { killSwitch } = context || {};
  if (killSwitch && killSwitch.isTriggered()) return { error: 'Kill switch triggered' };
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

function runMemorySearch(workspaceRoot, args) {
  const limit = Math.min(20, args.limit || 5);
  const hits = searchMemory(args.query, workspaceRoot, limit);
  return {
    results: hits.map((h) => ({ file: h.file_name, snippet: h.content.slice(0, 300), timestamp: h.timestamp }))
  };
}

function runEdit(workspaceRoot, args, context) {
  const { killSwitch } = context || {};
  if (killSwitch && killSwitch.isTriggered()) return { error: 'Kill switch triggered' };
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
  const { killSwitch } = context || {};
  if (killSwitch && killSwitch.isTriggered()) return { error: 'Kill switch triggered' };
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

function runCanvasStub() {
  return { error: 'Canvas tool requires OpenClaw node connection; not implemented in Aether-Claw.' };
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

function runSessionsSendStub() {
  return { error: 'sessions_send not implemented in Aether-Claw (no cross-session delivery).' };
}

function runSessionsSpawnStub() {
  return { error: 'sessions_spawn not implemented in Aether-Claw (no sub-agent runner).' };
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

/**
 * Execute a single tool by name with parsed arguments. Async for network/Telegram/vision tools.
 * @param {string} workspaceRoot - Project root path
 * @param {string} toolName - Tool name (exec, process, read_file, write_file, memory_search, edit, apply_patch, memory_get, web_search, web_fetch, browser, canvas, nodes, message, cron, gateway, sessions_*, agents_list, image)
 * @param {Object} args - Tool arguments (from LLM)
 * @param {Object} context - { killSwitch, config }
 * @returns {Promise<Object>} Result to send back to the model (will be JSON.stringify'd)
 */
async function runTool(workspaceRoot, toolName, args, context = {}) {
  const root = workspaceRoot || ROOT_DEFAULT;
  const killSwitch = context.killSwitch || getKillSwitch(root);
  const ctx = { ...context, killSwitch };

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
      return runCanvasStub();
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
      return runSessionsSendStub();
    case 'sessions_spawn':
      return runSessionsSpawnStub();
    case 'agents_list':
      return runAgentsList();
    case 'image':
      return await runImage(root, args, ctx);
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
  SESSION_MAIN
};
