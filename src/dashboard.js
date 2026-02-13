#!/usr/bin/env node
/**
 * Aether-Claw Dashboard (Node)
 * Simple HTTP server: status JSON + static HTML UI.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.resolve(__dirname, '..');
const { loadConfig } = require('./config');
const { readIndex } = require('./brain');
const { listSkills } = require('./safe-skill-creator');
const { getKillSwitch } = require('./kill-switch');

function getSystemStatus() {
  try {
    const config = loadConfig(path.join(ROOT, 'swarm_config.json'));
    const index = readIndex(ROOT);
    const fileCount = Object.keys(index.files || {}).length;
    const skills = listSkills(path.join(ROOT, 'skills'));
    const validSkills = skills.filter(s => s.signature_valid).length;
    const ks = getKillSwitch(ROOT);
    return {
      version: config.version || '1.0.0',
      indexed_files: fileCount,
      total_versions: Object.values(index.files || {}).reduce((s, f) => s + (f.versions?.length || 0), 0),
      skills: skills.length,
      valid_skills: validSkills,
      safety_gate: (config.safety_gate && config.safety_gate.enabled !== false),
      kill_switch_armed: ks.isArmed(),
      kill_switch_triggered: ks.isTriggered(),
      telegram_enabled: !!process.env.TELEGRAM_BOT_TOKEN
    };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

const HTML = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Aether-Claw</title>
<style>
  body { font-family: system-ui; max-width: 800px; margin: 2rem auto; padding: 0 1rem; background: #1a1a2e; color: #e0e0e0; }
  h1 { color: #7dd3fc; }
  .metric { background: #16213e; border-radius: 8px; padding: 12px; margin: 8px 0; }
  .metric span { color: #a5b4fc; }
  pre { background: #0f172a; padding: 12px; border-radius: 6px; overflow: auto; }
</style>
</head>
<body>
  <h1>Aether-Claw Dashboard</h1>
  <p>Node version – status only. Use TUI for chat: <code>node src/cli.js tui</code></p>
  <div id="status"></div>
  <script>
    fetch('/status').then(r=>r.json()).then(d=>{
      const el = document.getElementById('status');
      if (d.error) { el.innerHTML = '<p class="metric">Error: ' + d.error + '</p>'; return; }
      el.innerHTML = [
        '<div class="metric">Indexed files: <span>' + d.indexed_files + '</span></div>',
        '<div class="metric">Skills: <span>' + d.valid_skills + '/' + d.skills + '</span> valid</div>',
        '<div class="metric">Telegram: <span>' + (d.telegram_enabled ? 'enabled' : 'off') + '</span></div>',
        '<div class="metric">Kill switch: armed=' + d.kill_switch_armed + ', triggered=' + d.kill_switch_triggered + '</div>',
        '<pre>' + JSON.stringify(d, null, 2) + '</pre>'
      ].join('');
    }).catch(e=> document.getElementById('status').innerHTML = '<p>Failed to load status</p>');
  </script>
</body>
</html>
`;

const server = http.createServer((req, res) => {
  if (req.url === '/status' || req.url === '/status/') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(getSystemStatus()));
    return;
  }
  if (req.url === '/' || req.url === '/index.html') {
    res.setHeader('Content-Type', 'text/html');
    res.end(HTML);
    return;
  }
  res.statusCode = 404;
  res.end('Not found');
});

const port = Number(process.env.PORT) || 8501;
server.listen(port, () => console.log(`Dashboard: http://localhost:${port}`));
