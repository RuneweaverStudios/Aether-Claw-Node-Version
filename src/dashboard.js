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
const { createReplyDispatcher, resolveSessionKey } = require('./gateway');
const { isFirstRun, getBootstrapFirstMessage } = require('./personality');

function getSystemStatus() {
  try {
    const config = loadConfig(path.join(ROOT, 'swarm_config.json'));
    const index = readIndex(ROOT);
    const fileCount = Object.keys(index.files || {}).length;
    const { listEligibleSkills, listAllSkillsWithAuditStatus } = require('./openclaw-skills');
    const allSkills = listAllSkillsWithAuditStatus(ROOT);
    const eligibleSkills = listEligibleSkills(ROOT);
    const heartbeatMin = config.heartbeat?.interval_minutes ?? 30;
    const firstRun = isFirstRun(ROOT);
    return {
      version: config.version || '1.0.0',
      indexed_files: fileCount,
      total_versions: Object.values(index.files || {}).reduce((s, f) => s + (f.versions?.length || 0), 0),
      skills: allSkills.length,
      valid_skills: eligibleSkills.length,
      safety_gate: (config.safety_gate && config.safety_gate.enabled !== false),
      telegram_enabled: !!process.env.TELEGRAM_BOT_TOKEN,
      heartbeat_interval_minutes: heartbeatMin,
      reasoning_model: config.model_routing?.tier_1_reasoning?.model,
      action_model: config.model_routing?.tier_2_action?.model,
      first_run: firstRun,
      bootstrap_first_message: firstRun ? getBootstrapFirstMessage() : undefined
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

function getSecurityData() {
  try {
    const config = loadConfig(path.join(ROOT, 'swarm_config.json'));
    const { getAuditSummary, getFailedSkillIds } = require('./skill-audit');
    const { listAllSkillsWithAuditStatus } = require('./openclaw-skills');
    const auditSummary = getAuditSummary(ROOT);
    const failedIds = getFailedSkillIds(ROOT);
    const allSkills = listAllSkillsWithAuditStatus(ROOT);
    const safetyGateEnabled = config.safety_gate && config.safety_gate.enabled !== false;

    const warnings = [];
    const notifications = [];

    if (!safetyGateEnabled) {
      warnings.push('Safety gate is disabled.');
      notifications.push('Safety gate disabled');
    }
    if (failedIds.length > 0) {
      warnings.push(failedIds.length + ' skill(s) failed security audit: ' + failedIds.join(', '));
      notifications.push(failedIds.length + ' skills failed audit');
    }

    return {
      warnings,
      notifications,
      safety_gate_enabled: safetyGateEnabled,
      audit_summary: {
        total: auditSummary.total,
        passed: auditSummary.passed,
        failed: auditSummary.failed
      },
      skills_audit: allSkills.map(s => ({ id: s.id, name: s.name, audit: s.audit, report: s.report || '' }))
    };
  } catch (e) {
    return { error: String(e.message || e), warnings: [], notifications: [] };
  }
}

const replyDispatcher = createReplyDispatcher({ workspaceRoot: ROOT });

async function handleChatMessage(message) {
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return { error: 'Message is required' };
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return { error: 'OPENROUTER_API_KEY not set. Run: aetherclaw onboard' };
  }
  const sessionKey = resolveSessionKey({ channel: 'dashboard' });
  try {
    const result = await replyDispatcher(sessionKey, message.trim(), { channel: 'dashboard' });
    if (result.error && !result.reply) return { error: result.error };
    return { reply: result.reply || '', toolCallsCount: result.toolCallsCount };
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
    .msg .content pre { margin: 0.5rem 0; padding: 1rem; border-radius: 8px; overflow-x: auto; background: #0f172a; border: 1px solid var(--border); position: relative; }
    .msg .content pre .copy-btn { position: absolute; top: 0.5rem; right: 0.5rem; padding: 0.25rem 0.5rem; font-size: 0.75rem; background: var(--border); color: var(--text); border: none; border-radius: 4px; cursor: pointer; }
    .msg .content pre .copy-btn:hover { background: var(--accent); color: var(--bg); }
    .msg .content code { font-family: ui-monospace, monospace; font-size: 0.9em; }
    .msg .content p { margin: 0.25rem 0; }
    .msg.assistant .content.collapsible { max-height: 300px; overflow: hidden; }
    .msg.assistant .content.collapsible.expanded { max-height: none; }
    .msg.assistant .content .show-more-less { display: block; margin-top: 0.5rem; cursor: pointer; color: var(--accent); font-size: 0.9rem; }
    .chat-banner { padding: 0.5rem 1rem; margin-bottom: 0.5rem; border-radius: 8px; font-size: 0.9rem; }
    .chat-banner.warning { background: rgba(248,113,113,0.2); border: 1px solid #f87171; color: #fca5a5; }
    .chat-banner.info { background: rgba(56,189,248,0.15); border: 1px solid var(--accent); color: var(--accent); }
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
      <button type="button" data-tab="security">Security</button>
      <button type="button" data-tab="config">Config</button>
    </div>
    <div id="chatPanel" class="panel active">
      <div id="chatBanner"></div>
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
    <div id="securityPanel" class="panel">
      <div id="securityWarnings"></div>
      <div class="status-grid" id="securityGrid"></div>
      <div id="securitySkills"></div>
      <pre class="raw" id="securityRaw"></pre>
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
        if (name === 'security') loadSecurity();
        if (name === 'config') loadConfig();
        if (name !== 'security' && securityPollTimer) { clearInterval(securityPollTimer); securityPollTimer = null; }
      });
    });
    const messagesEl = document.getElementById('messages');
    const chatForm = document.getElementById('chatForm');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('sendBtn');
    let history = JSON.parse(sessionStorage.getItem('aetherHistory') || '[]');
    const COLLAPSE_THRESHOLD = 800;
    function renderHistory() {
      messagesEl.innerHTML = history.map((m) => {
        let html = m.role === 'assistant' ? renderMarkdown(m.content) : escapeHtml(m.content);
        const isLong = m.role === 'assistant' && m.content && m.content.length > COLLAPSE_THRESHOLD;
        const contentClass = isLong ? 'content collapsible' : 'content';
        const showMore = isLong ? '<span class="show-more-less" data-action="expand">Show more</span>' : '';
        return '<div class="msg ' + m.role + '"><div class="role">' + m.role + '</div><div class="' + contentClass + '">' + html + showMore + '</div></div>';
      }).join('');
      messagesEl.querySelectorAll('.msg .content pre').forEach((pre) => {
        const code = pre.querySelector('code');
        const text = code ? code.textContent : pre.textContent;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'copy-btn';
        btn.textContent = 'Copy';
        btn.addEventListener('click', () => {
          navigator.clipboard.writeText(text).then(() => { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); });
        });
        pre.appendChild(btn);
      });
      messagesEl.querySelectorAll('.show-more-less').forEach((el) => {
        el.addEventListener('click', () => {
          const content = el.closest('.msg').querySelector('.content');
          const isExpanded = content.classList.contains('expanded');
          content.classList.toggle('expanded', !isExpanded);
          el.textContent = isExpanded ? 'Show more' : 'Show less';
        });
      });
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function addMessage(role, content) {
      history.push({ role, content });
      sessionStorage.setItem('aetherHistory', JSON.stringify(history));
      renderHistory();
    }
    renderHistory();
    const bannerEl = document.getElementById('chatBanner');
    function showBanner(cls, text) {
      bannerEl.innerHTML = '<div class="chat-banner ' + cls + '">' + escapeHtml(text) + '</div>';
    }
    function clearBanner() {
      bannerEl.innerHTML = '';
    }
    fetch('/status').then(function(r) { return r.json(); }).then(function(d) {
      if (d.error) {
        showBanner('warning', 'Status: ' + d.error + '. Run aetherclaw onboard to fix.');
      } else if (d.first_run) {
        showBanner('info', 'First run: complete setup with aetherclaw onboard, or send a message to start.');
      } else {
        clearBanner();
      }
      if (d.first_run && history.length === 0 && d.bootstrap_first_message) {
        history = [{ role: 'user', content: 'Wake up!' }, { role: 'assistant', content: d.bootstrap_first_message }];
        sessionStorage.setItem('aetherHistory', JSON.stringify(history));
        renderHistory();
      }
    }).catch(function() {
      showBanner('warning', 'Could not load status. Is the gateway running?');
    });
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
        '<div class="card"><h3>Reasoning model</h3><div class="value">' + (d.reasoning_model || '—') + '</div></div>'
      ].join('');
      raw.textContent = JSON.stringify(d, null, 2);
    }
    async function loadConfig() {
      const res = await fetch('/api/config');
      const d = await res.json();
      document.getElementById('configRaw').textContent = JSON.stringify(d, null, 2);
    }
    let securityPollTimer = null;
    async function loadSecurity() {
      const res = await fetch('/api/security');
      const d = await res.json();
      const warnEl = document.getElementById('securityWarnings');
      const gridEl = document.getElementById('securityGrid');
      const skillsEl = document.getElementById('securitySkills');
      const rawEl = document.getElementById('securityRaw');
      if (d.error) {
        warnEl.innerHTML = '<p class="error">' + escapeHtml(d.error) + '</p>';
        gridEl.innerHTML = '';
        skillsEl.innerHTML = '';
        rawEl.textContent = d.error;
        return;
      }
      warnEl.innerHTML = '';
      if (d.warnings && d.warnings.length > 0) {
        warnEl.innerHTML = '<div class="card" style="border-color:#f87171;"><h3>Warnings</h3>' + d.warnings.map(function(w) { return '<p class="error">' + escapeHtml(w) + '</p>'; }).join('') + '</div>';
      }
      if (d.notifications && d.notifications.length > 0) {
        warnEl.innerHTML = (warnEl.innerHTML || '') + '<div class="card"><h3>Notifications</h3><ul>' + d.notifications.map(function(n) { return '<li>' + escapeHtml(n) + '</li>'; }).join('') + '</ul></div>';
      }
      gridEl.innerHTML = [
        '<div class="card"><h3>Safety gate</h3><div class="value">' + (d.safety_gate_enabled ? 'On' : 'Off') + '</div></div>',
        '<div class="card"><h3>Audit passed</h3><div class="value">' + (d.audit_summary ? d.audit_summary.passed : 0) + '</div></div>',
        '<div class="card"><h3>Audit failed</h3><div class="value">' + (d.audit_summary ? d.audit_summary.failed : 0) + '</div></div>'
      ].join('');
      if (d.skills_audit && d.skills_audit.length > 0) {
        skillsEl.innerHTML = '<h3 style="margin-top:1rem;">Skills audit</h3><table style="width:100%;border-collapse:collapse;"><thead><tr><th style="text-align:left;">Skill</th><th style="text-align:left;">Status</th><th style="text-align:left;">Report</th></tr></thead><tbody>' + d.skills_audit.map(function(s) {
          return '<tr><td>' + escapeHtml(s.name) + '</td><td>' + (s.audit === 'passed' ? 'Passed' : '<span class="error">Failed</span>') + '</td><td style="font-size:0.85rem;">' + escapeHtml(s.report ? s.report.slice(0, 80) : '') + '</td></tr>';
        }).join('') + '</tbody></table>';
      } else {
        skillsEl.innerHTML = '';
      }
      rawEl.textContent = JSON.stringify(d, null, 2);
      if (securityPollTimer) clearInterval(securityPollTimer);
      securityPollTimer = setInterval(loadSecurity, 30000);
    }
  </script>
</body>
</html>
`;

/** Mobile-first Web Chat: WS connect, agent with streaming, copy/collapse. Served at /webchat */
const WEBCHAT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Aether-Claw Chat</title>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/highlight.min.js"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/github-dark.min.css">
  <style>
    :root { --bg: #0f172a; --surface: #1e293b; --border: #334155; --text: #e2e8f0; --accent: #38bdf8; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: var(--bg); color: var(--text); min-height: 100vh; }
    .wc-layout { display: flex; flex-direction: column; min-height: 100vh; padding: 0.5rem; max-width: 640px; margin: 0 auto; }
    .wc-banner { padding: 0.5rem; margin-bottom: 0.5rem; border-radius: 8px; font-size: 0.9rem; }
    .wc-banner.warn { background: rgba(248,113,113,0.2); border: 1px solid #f87171; }
    .wc-banner.ok { background: rgba(56,189,248,0.15); border: 1px solid var(--accent); }
    .wc-messages { flex: 1; overflow-y: auto; padding: 0.5rem 0; }
    .wc-msg { margin-bottom: 1rem; max-width: 90%; }
    .wc-msg.user { margin-left: auto; background: #1e3a5f; padding: 0.75rem 1rem; border-radius: 12px; }
    .wc-msg.assistant { background: var(--surface); padding: 0.75rem 1rem; border-radius: 12px; border: 1px solid var(--border); }
    .wc-msg .role { font-size: 0.75rem; opacity: 0.8; }
    .wc-msg .content pre { position: relative; margin: 0.5rem 0; padding: 1rem; border-radius: 8px; overflow-x: auto; background: #0f172a; }
    .wc-msg .content pre .copy-btn { position: absolute; top: 0.25rem; right: 0.25rem; padding: 0.25rem 0.5rem; font-size: 0.75rem; background: var(--border); color: var(--text); border: none; border-radius: 4px; cursor: pointer; }
    .wc-msg .content.collapsible { max-height: 280px; overflow: hidden; }
    .wc-msg .content.collapsible.expanded { max-height: none; }
    .wc-msg .show-more { cursor: pointer; color: var(--accent); font-size: 0.85rem; margin-top: 0.25rem; }
    .wc-form { display: flex; gap: 0.5rem; padding: 0.5rem 0; }
    .wc-form input { flex: 1; padding: 0.75rem 1rem; min-height: 48px; font-size: 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--text); }
    .wc-form button { padding: 0.75rem 1.25rem; min-height: 48px; background: var(--accent); color: var(--bg); border: none; border-radius: 8px; cursor: pointer; font-weight: 600; }
    .wc-form button:disabled { opacity: 0.6; cursor: not-allowed; }
    .wc-form .wc-plan { font-size: 0.85rem; opacity: 0.9; white-space: nowrap; }
    .wc-steps { font-size: 0.8rem; opacity: 0.9; margin-top: 0.25rem; }
    .wc-usage { font-size: 0.75rem; opacity: 0.7; margin-top: 0.25rem; }
  </style>
</head>
<body>
  <div class="wc-layout">
    <div id="wcBanner" class="wc-banner warn">Connecting...</div>
    <div class="wc-messages" id="wcMessages"></div>
    <form class="wc-form" id="wcForm">
      <label class="wc-plan"><input type="checkbox" id="wcPlan" /> Plan (read-only)</label>
      <input type="text" id="wcInput" placeholder="Message..." autocomplete="off" />
      <button type="submit" id="wcSend">Send</button>
    </form>
  </div>
  <script>
    marked.setOptions({ gfm: true, breaks: true });
    function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function md(s) { const d = document.createElement('div'); d.innerHTML = marked.parse(s || ''); d.querySelectorAll('pre code').forEach(function(c) { if (window.hljs) hljs.highlightElement(c); }); return d.innerHTML; }
    const messagesEl = document.getElementById('wcMessages');
    const form = document.getElementById('wcForm');
    const input = document.getElementById('wcInput');
    const sendBtn = document.getElementById('wcSend');
    const banner = document.getElementById('wcBanner');
    let ws = null;
    let reqId = 0;
    let pending = new Map();
    let history = [];
    let currentRunId = null;
    let currentBubble = null;
    let queue = [];

    function wsUrl() {
      const p = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return p + '//' + location.host;
    }
    function connect() {
      ws = new WebSocket(wsUrl());
      ws.onopen = () => {
        const id = 'c' + (++reqId);
        ws.send(JSON.stringify({ type: 'req', id, method: 'connect', params: { role: 'operator', scopes: ['operator.read', 'operator.write'] } }));
        pending.set(id, { resolve: (v) => { banner.textContent = 'Connected'; banner.className = 'wc-banner ok'; } });
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'res' && pending.has(msg.id)) {
            const p = pending.get(msg.id); pending.delete(msg.id);
            if (msg.ok && msg.payload) {
              if (msg.payload.type === 'hello-ok') p.resolve();
              else if (msg.payload.runId) currentRunId = msg.payload.runId;
            } else if (!msg.ok) {
              if (msg.payload && msg.payload.busy) {
                var lastAssistant = document.querySelector('.wc-msg.assistant:last-child');
                if (lastAssistant) lastAssistant.remove();
                var lastUser = document.querySelector('.wc-msg.user:last-child');
                var text = lastUser && lastUser.querySelector('.content') ? lastUser.querySelector('.content').textContent : '';
                if (text) queue.unshift(text);
                sendBtn.disabled = false;
                currentBubble = null; currentRunId = null;
              } else banner.textContent = 'Auth failed';
            }
          }
          if (msg.type === 'event') {
            if (msg.event === 'agent.chunk' && msg.payload && msg.payload.runId === currentRunId && currentBubble) {
              const tail = msg.payload.delta || '';
              const prev = currentBubble.dataset.raw || '';
              currentBubble.dataset.raw = prev + tail;
              currentBubble.innerHTML = md(prev + tail);
              currentBubble.querySelectorAll('pre').forEach(function(pre) {
                if (pre.querySelector('.copy-btn')) return;
                const code = pre.querySelector('code');
                const text = (code ? code.textContent : pre.textContent) || '';
                const btn = document.createElement('button'); btn.className = 'copy-btn'; btn.textContent = 'Copy';
                btn.onclick = () => { navigator.clipboard.writeText(text); btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); };
                pre.appendChild(btn);
              });
              messagesEl.scrollTop = messagesEl.scrollHeight;
            }
            if (msg.event === 'agent.step' && msg.payload && msg.payload.step) {
              const step = msg.payload.step;
              const name = step.name || step.type;
              const msgEl = document.querySelector('.wc-msg.assistant:last-child');
              if (msgEl) {
                let stepsEl = msgEl.querySelector('.wc-steps');
                if (!stepsEl) { stepsEl = document.createElement('div'); stepsEl.className = 'wc-steps'; msgEl.appendChild(stepsEl); }
                if (step.type === 'tool_call') stepsEl.textContent += ' Running ' + name + '... ';
              }
            }
            if (msg.event === 'agent.idle' && msg.payload) {
              if (queue.length > 0) { const next = queue.shift(); setTimeout(() => send(next), 0); }
            }
            if (msg.event === 'agent' && msg.payload) {
              const p = msg.payload;
              const msgEl = document.querySelector('.wc-msg.assistant:last-child');
              const contentEl = msgEl && msgEl.querySelector('.content');
              if (p.status === 'completed' && contentEl) {
                contentEl.dataset.raw = p.reply || '';
                contentEl.innerHTML = md(p.reply || '');
                contentEl.querySelectorAll('pre').forEach(function(pre) {
                  if (pre.querySelector('.copy-btn')) return;
                  const code = pre.querySelector('code');
                  const text = (code ? code.textContent : pre.textContent) || '';
                  const btn = document.createElement('button'); btn.className = 'copy-btn'; btn.textContent = 'Copy';
                  btn.onclick = () => { navigator.clipboard.writeText(text); btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); };
                  pre.appendChild(btn);
                });
                if (p.usage && (p.usage.prompt_tokens != null || p.usage.completion_tokens != null || p.usage.total_tokens != null)) {
                  var u = p.usage;
                  var usageEl = document.createElement('div'); usageEl.className = 'wc-usage';
                  if (u.prompt_tokens != null && u.completion_tokens != null) usageEl.textContent = 'prompt: ' + u.prompt_tokens + ', completion: ' + u.completion_tokens;
                  else if (u.total_tokens != null) usageEl.textContent = u.total_tokens + ' tokens';
                  else usageEl.textContent = (u.prompt_tokens || 0) + (u.completion_tokens || 0) + ' tokens';
                  msgEl.appendChild(usageEl);
                }
                if ((p.reply || '').length > 800) {
                  contentEl.classList.add('collapsible');
                  const show = document.createElement('div'); show.className = 'show-more'; show.textContent = 'Show more';
                  show.onclick = () => { contentEl.classList.toggle('expanded'); show.textContent = contentEl.classList.contains('expanded') ? 'Show less' : 'Show more'; };
                  contentEl.appendChild(show);
                }
                history.push({ role: 'assistant', content: p.reply || '' });
              }
              if (p.status === 'failed' && contentEl) {
                contentEl.innerHTML = '<span style="color:#f87171">Error: ' + escapeHtml(p.error || '') + '</span>';
              }
              currentRunId = null; currentBubble = null;
              sendBtn.disabled = false;
              if (queue.length > 0) { const next = queue.shift(); setTimeout(() => send(next), 0); }
            }
          }
        } catch (err) {}
      };
      ws.onclose = () => { banner.textContent = 'Disconnected'; banner.className = 'wc-banner warn'; setTimeout(connect, 2000); };
      ws.onerror = () => {};
    }
    function send(text) {
      if (!ws || ws.readyState !== 1) { queue.push(text); return; }
      const id = 'r' + (++reqId);
      const planEl = document.getElementById('wcPlan');
      ws.send(JSON.stringify({ type: 'req', id, method: 'agent', params: { message: text, sessionKey: 'webchat', stream: true, readOnly: planEl && planEl.checked } }));
      pending.set(id, { resolve: (v) => {} });
      const userDiv = document.createElement('div');
      userDiv.className = 'wc-msg user';
      userDiv.innerHTML = '<div class="role">user</div><div class="content">' + escapeHtml(text) + '</div>';
      messagesEl.appendChild(userDiv);
      currentRunId = null;
      currentBubble = document.createElement('div');
      currentBubble.className = 'wc-msg assistant';
      currentBubble.innerHTML = '<div class="role">assistant</div><div class="content">Thinking...</div><div class="wc-steps"></div>';
      currentBubble.querySelector('.content').dataset.raw = '';
      messagesEl.appendChild(currentBubble);
      currentBubble = currentBubble.querySelector('.content');
      messagesEl.scrollTop = messagesEl.scrollHeight;
      sendBtn.disabled = true;
    }
    form.onsubmit = (e) => {
      e.preventDefault();
      const t = input.value.trim();
      if (!t) return;
      input.value = '';
      send(t);
    };
    connect();
  </script>
</body>
</html>
`;

/**
 * Create the HTTP request handler for the dashboard (status, config, security, chat, HTML).
 * Used by standalone dashboard server and by daemon when serving dashboard on gateway port.
 */
function createDashboardRequestHandler() {
  return async (req, res) => {
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
    if (url === '/api/security' || url === '/api/security/') {
      setJson();
      res.end(JSON.stringify(getSecurityData()));
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
    if (url === '/webchat' || url === '/webchat/') {
      setHtml();
      res.end(WEBCHAT_HTML);
      return;
    }
    if (url === '/' || url === '/index.html') {
      setHtml();
      res.end(HTML);
      return;
    }
    res.statusCode = 404;
    res.end('Not found');
  };
}

const server = http.createServer(createDashboardRequestHandler());

function startStandaloneServer(port) {
  const p = port != null ? Number(port) : (Number(process.env.PORT) || 18789);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${p} is already in use. Dashboard may already be running.`);
      console.error(`Open http://localhost:${p} in your browser.`);
      process.exit(0);
    }
    throw err;
  });
  server.listen(p, () => console.log(`Dashboard: http://localhost:${p}`));
}

module.exports = {
  getSystemStatus,
  getConfigForUI,
  getSecurityData,
  createDashboardRequestHandler,
  startStandaloneServer
};
