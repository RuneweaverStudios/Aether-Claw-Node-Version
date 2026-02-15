/**
 * Hooks: run scripts or callbacks when agent events fire (e.g. session reset).
 * Config: swarm_config.json hooks.on_session_reset = array of script paths or { run: "path" }.
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { loadConfig } = require('./config');

const ROOT_DEFAULT = path.resolve(__dirname, '..');

/**
 * Run hooks for an event. Hooks are from config.hooks[eventName] (array of strings or { run: "path" }).
 * Each entry can be a script path (relative to workspace root) or an object { run: "path", args: [] }.
 * @param {string} workspaceRoot
 * @param {string} eventName - e.g. 'on_session_reset'
 * @param {Object} payload - e.g. { sessionKey: 'main' }
 */
function runHooks(workspaceRoot, eventName, payload = {}) {
  const root = workspaceRoot || ROOT_DEFAULT;
  const configPath = path.join(root, 'swarm_config.json');
  let config;
  try {
    config = loadConfig(configPath);
  } catch (e) {
    return;
  }
  const list = config.hooks && config.hooks[eventName];
  if (!Array.isArray(list) || list.length === 0) return;
  const env = { ...process.env, AETHERCLAW_EVENT: eventName, AETHERCLAW_SESSION_KEY: payload.sessionKey || '' };
  for (const entry of list) {
    const run = typeof entry === 'string' ? entry : entry && entry.run;
    if (!run) continue;
    const scriptPath = path.isAbsolute(run) ? run : path.join(root, run);
    if (!fs.existsSync(scriptPath)) continue;
    try {
      execSync(process.execPath + ' ' + scriptPath + ' ' + (payload.sessionKey || ''), {
        cwd: root,
        env,
        stdio: 'pipe',
        timeout: 30000
      });
    } catch (e) {
      if (process.env.DEBUG) console.error('[hooks]', eventName, run, e.message);
    }
  }
}

module.exports = { runHooks };
