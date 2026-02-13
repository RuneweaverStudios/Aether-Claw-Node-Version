#!/usr/bin/env node
/**
 * Aether-Claw Dashboard (Node)
 * HTTP server: status, config, and chat API + Web UI with markdown/code blocks.
 * OpenClaw-inspired: gateway routing, heartbeat config, chat with code block rendering.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.resolve(__dirname, '..');
const { loadConfig } = require('./config');
const { readIndex } = require('./brain');
const { searchMemory } = require('./brain');
const { listSkills } = require('./safe-skill-creator');
const { getKillSwitch } = require('./kill-switch');
const { routePrompt } = require('./gateway');
const { callLLM } = require('./api');
const { runAgentLoop } = require('./agent-loop');

const CHAT_SYSTEM = 'You are Aether-Claw, a secure AI assistant with memory and skills. Be helpful and concise.';
const ACTION_SYSTEM = 'You are an expert programmer with access to tools: exec (run shell commands in the project), process (manage background exec sessions), read_file, write_file, memory_search. Use these tools to run commands, read and write files, and search memory. Prefer running code and editing files via tools rather than only showing code in chat.';
const REFLECT_SYSTEM = 'You are Aether-Claw. Help the user plan, break down problems, and think through options. Be structured and clear.';

function getSystemStatus() {
  try {
    const config = loadConfig(path.join(ROOT, 'swarm_config.json'));
    const index = readIndex(ROOT);
    const fileCount = Object.keys(index.files || {}).length;
    const skills = listSkills(path.join(ROOT, 'skills'));
    const validSkills = skills.filter(s => s.signature_valid).length;
    const ks = getKillSwitch(ROOT);
    const heartbeatMin = config.heartbeat?.interval_minutes ?? 30;
    return {
      version: config.version || '1.0.0',
      indexed_files: fileCount,
      total_versions: Object.values(index.files || {}).reduce((s, f) => s + (f.versions?.length || 0), 0),
      skills: skills.length,
      valid_skills: validSkills,
      safety_gate: (config.safety_gate && config.safety_gate.enabled !== false),
      kill_switch_armed: ks.isArmed(),
      kill_switch_triggered: ks.isTriggered(),
      telegram_enabled: !!process.env.TELEGRAM_BOT_TOKEN,
      heartbeat_interval_minutes: heartbeatMin,
      reasoning_model: config.model_routing?.tier_1_reasoning?.model,
      action_model: config.model_routing?.tier_2_action?.model
    };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

function getConfigForUI() {
  try {
    const config = loadConfig(path.join(ROOT, 'swarm_config.json'));
    return {
      version: config.version,
      system_name: config.system_name,
      model_routing: config.model_routing,
      heartbeat: config.heartbeat ?? { interval_minutes: 30 },
      safety_gate: config.safety_gate
    };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

async function handleChatMessage(message) {
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return { error: 'Message is required' };
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return { error: 'OPENROUTER_API_KEY not set. Run: node src/cli.js onboard' };
  }
  const config = loadConfig(path.join(ROOT, 'swarm_config.json'));
  const { action, query } = routePrompt(message.trim());
  let systemPrompt = CHAT_SYSTEM;
  let tier = 'reasoning';
  if (action === 'action') {
    systemPrompt = ACTION_SYSTEM;
    tier = 'action';
  } else if (action === 'reflect') {
    systemPrompt = REFLECT_SYSTEM;
    tier = 'reasoning';
  } else if (action === 'memory') {
    const hits = searchMemory(query, ROOT, 5);
    const memoryContext = hits.length
      ? 'Relevant memory:\n' + hits.map((h) => h.file_name + ': ' + h.content.slice(0, 200)).join('\n\n')
      : 'No matching memory.';
    systemPrompt = CHAT_SYSTEM + '\n\n' + memoryContext;
    tier = 'reasoning';
  }

  try {
    if (action === 'action') {
      const result = await runAgentLoop(ROOT, query, ACTION_SYSTEM, config, { tier: 'action', max_tokens: 4096 });
      if (result.error && !result.reply) return { error: result.error };
      return { reply: result.reply || '', action, toolCallsCount: result.toolCallsCount };
    }
    const reply = await callLLM(
      { prompt: query, systemPrompt, tier, max_tokens: 4096 },
      config
    );
    return { reply: reply || '', action };
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Aether-Claw</title>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/highlight.min.js"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/github-dark.min.css">
  <style>
    :root { --bg: #0f172a; --surface: #1e293b; --border: #334155; --text: #e2e8f0; --accent: #38bdf8; --user: #1e3a5f; --assistant: #1e293b; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: var(--bg); color: var(--text); min-height: 100vh; }
    .layout { max-width: 900px; margin: 0 auto; padding: 1rem; display: flex; flex-direction: column; min-height: 100vh; }
    header { display: flex; align-items: center; gap: 1rem; padding: 0.75rem 0; border-bottom: 1px solid var(--border); margin-bottom: 1rem; }
    header h1 { margin: 0; font-size: 1.35rem; color: var(--accent); }
    .tabs { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
    .tabs button { padding: 0.5rem 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--text); cursor: pointer; }
    .tabs button.active { background: var(--accent); color: var(--bg); border-color: var(--accent); }
    .panel { display: none; flex: 1; flex-direction: column; }
    .panel.active { display: flex; }
    #chatPanel { flex: 1; }
    .messages { flex: 1; overflow-y: auto; padding: 1rem 0; }
    .msg { margin-bottom: 1rem; max-width: 85%; }
    .msg.user { margin-left: auto; background: var(--user); padding: 0.75rem 1rem; border-radius: 12px; }
    .msg.assistant { background: var(--assistant); padding: 0.75rem 1rem; border-radius: 12px; border: 1px solid var(--border); }
    .msg .role { font-size: 0.75rem; opacity: 0.8; margin-bottom: 0.25rem; }
    .msg .content { word-break: break-word; }
    .msg .content pre { margin: 0.5rem 0; padding: 1rem; border-radius: 8px; overflow-x: auto; background: #0f172a; border: 1px solid var(--border); }
    .msg .content code { font-family: ui-monospace, monospace; font-size: 0.9em; }
    .msg .content p { margin: 0.25rem 0; }
    .chat-form { display: flex; gap: 0.5rem; padding: 0.5rem 0; }
    .chat-form input { flex: 1; padding: 0.75rem 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 1rem; }
    .chat-form button { padding: 0.75rem 1.25rem; background: var(--accent); color: var(--bg); border: none; border-radius: 8px; cursor: pointer; font-weight: 600; }
    .chat-form button:disabled { opacity: 0.6; cursor: not-allowed; }
    .status-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; }
    .card h3 { margin: 0 0 0.5rem; font-size: 0.9rem; color: var(--accent); }
    .card .value { font-size: 1.25rem; }
    pre.raw { background: var(--surface); padding: 1rem; border-radius: 8px; overflow: auto; font-size: 0.85rem; }
    .error { color: #f87171; }
    .typing { opacity: 0.7; font-style: italic; }
  </style>
</head>
<body>
  <div class="layout">
    <header>
      <h1>Aether-Claw</h1>
      <span style="font-size:0.9rem;opacity:0.8">Web UI</span>
    </header>
    <div class="tabs">
      <button type="button" data-tab="chat" class="active">Chat</button>
      <button type="button" data-tab="status">Status</button>
      <button type="button" data-tab="config">Config</button>
    </div>
    <div id="chatPanel" class="panel active">
      <div class="messages" id="messages"></div>
      <form class="chat-form" id="chatForm">
        <input type="text" id="input" placeholder="Message Aether-Claw..." autocomplete="off" />
        <button type="submit" id="sendBtn">Send</button>
      </form>
    </div>
    <div id="statusPanel" class="panel">
      <div class="status-grid" id="statusGrid"></div>
      <pre class="raw" id="statusRaw"></pre>
    </div>
    <div id="configPanel" class="panel">
      <pre class="raw" id="configRaw"></pre>
    </div>
  </div>
  <script>
    marked.setOptions({ gfm: true, breaks: true });
    function renderMarkdown(text) {
      if (!text) return '';
      const html = marked.parse(text);
      const div = document.createElement('div');
      div.innerHTML = html;
      div.querySelectorAll('pre code').forEach((el) => { if (window.hljs) hljs.highlightElement(el); });
      return div.innerHTML;
    }
    const tabs = document.querySelectorAll('.tabs button');
    const panels = document.querySelectorAll('.panel');
    tabs.forEach((t) => {
      t.addEventListener('click', () => {
        const name = t.dataset.tab;
        tabs.forEach((x) => x.classList.toggle('active', x === t));
        panels.forEach((p) => p.classList.toggle('active', p.id === name + 'Panel'));
        if (name === 'status') loadStatus();
        if (name === 'config') loadConfig();
      });
    });
    const messagesEl = document.getElementById('messages');
    const chatForm = document.getElementById('chatForm');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('sendBtn');
    let history = JSON.parse(sessionStorage.getItem('aetherHistory') || '[]');
    function renderHistory() {
      messagesEl.innerHTML = history.map((m) => {
        const html = m.role === 'assistant' ? renderMarkdown(m.content) : escapeHtml(m.content);
        return '<div class="msg ' + m.role + '"><div class="role">' + m.role + '</div><div class="content">' + html + '</div></div>';
      }).join('');
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function addMessage(role, content) {
      history.push({ role, content });
      sessionStorage.setItem('aetherHistory', JSON.stringify(history));
      renderHistory();
    }
    renderHistory();
    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = inputEl.value.trim();
      if (!text) return;
      addMessage('user', text);
      inputEl.value = '';
      sendBtn.disabled = true;
      const typing = document.createElement('div');
      typing.className = 'msg assistant typing';
      typing.innerHTML = '<div class="role">assistant</div><div class="content">Thinking...</div>';
      messagesEl.appendChild(typing);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      try {
        const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }) });
        const data = await res.json();
        typing.remove();
        if (data.error) addMessage('assistant', 'Error: ' + data.error);
        else addMessage('assistant', data.reply || '');
      } catch (err) {
        typing.remove();
        addMessage('assistant', 'Error: ' + (err.message || 'Network error'));
      }
      sendBtn.disabled = false;
    });
    async function loadStatus() {
      const res = await fetch('/status');
      const d = await res.json();
      const grid = document.getElementById('statusGrid');
      const raw = document.getElementById('statusRaw');
      if (d.error) { grid.innerHTML = ''; raw.textContent = d.error; return; }
      grid.innerHTML = [
        '<div class="card"><h3>Indexed files</h3><div class="value">' + d.indexed_files + '</div></div>',
        '<div class="card"><h3>Skills</h3><div class="value">' + d.valid_skills + ' / ' + d.skills + '</div></div>',
        '<div class="card"><h3>Telegram</h3><div class="value">' + (d.telegram_enabled ? 'On' : 'Off') + '</div></div>',
        '<div class="card"><h3>Heartbeat</h3><div class="value">' + (d.heartbeat_interval_minutes || 30) + ' min</div></div>',
        '<div class="card"><h3>Reasoning model</h3><div class="value">' + (d.reasoning_model || '—') + '</div></div>',
        '<div class="card"><h3>Kill switch</h3><div class="value">' + (d.kill_switch_triggered ? 'Triggered' : d.kill_switch_armed ? 'Armed' : 'Off') + '</div></div>'
      ].join('');
      raw.textContent = JSON.stringify(d, null, 2);
    }
    async function loadConfig() {
      const res = await fetch('/api/config');
      const d = await res.json();
      document.getElementById('configRaw').textContent = JSON.stringify(d, null, 2);
    }
  </script>
</body>
</html>
`;

const server = http.createServer(async (req, res) => {
  const url = req.url?.split('?')[0];
  const setJson = () => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
  };
  const setHtml = () => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
  };

  if (url === '/status' || url === '/status/') {
    setJson();
    res.end(JSON.stringify(getSystemStatus()));
    return;
  }
  if (url === '/api/config') {
    setJson();
    res.end(JSON.stringify(getConfigForUI()));
    return;
  }
  if (url === '/api/chat' && req.method === 'POST') {
    let body = '';
    try {
      body = await readBody(req);
      const { message } = JSON.parse(body || '{}');
      const result = await handleChatMessage(message);
      setJson();
      res.end(JSON.stringify(result));
    } catch (e) {
      setJson();
      res.statusCode = 400;
      res.end(JSON.stringify({ error: e.message || 'Invalid request' }));
    }
    return;
  }
  if (url === '/' || url === '/index.html') {
    setHtml();
    res.end(HTML);
    return;
  }
  res.statusCode = 404;
  res.end('Not found');
});

const port = Number(process.env.PORT) || 8501;
server.listen(port, () => console.log(`Dashboard: http://localhost:${port}`));
