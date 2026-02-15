const path = require('path');
const fs = require('fs');

/**
 * Optional gateway config persisted in swarm_config.json.
 * gateway.port, gateway.bind, gateway.auth (mode, token | password), gateway.tailscale.mode
 */
const DEFAULT_CONFIG = {
  version: '1.0.0',
  system_name: 'Aether-Claw',
  model_routing: {
    tier_1_reasoning: {
      model: 'anthropic/claude-3.7-sonnet',
      max_tokens: 4096,
      temperature: 0.3
    },
    tier_2_action: {
      model: 'anthropic/claude-3.5-haiku',
      max_tokens: 2048,
      temperature: 0.5
    },
    complexity_classifier: {
      enabled: true,
      model: 'google/gemini-2.5-flash'
    },
    complexity_threshold: 4
  },
  brain: { directory: 'brain' },
  safety_gate: { enabled: true },
  heartbeat: { interval_minutes: 30 },
  cron: { jobs: [] },
  gateway: { port: 8501, bind: 'loopback', auth: { mode: 'token' } },
  hooks: { on_session_reset: [] }
};

function loadConfig(configPath) {
  const dir = configPath || path.join(process.cwd(), 'swarm_config.json');
  try {
    const raw = fs.readFileSync(dir, 'utf8');
    const merged = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    merged.model_routing = { ...DEFAULT_CONFIG.model_routing, ...(merged.model_routing || {}) };
    merged.model_routing.complexity_classifier = { ...DEFAULT_CONFIG.model_routing.complexity_classifier, ...(merged.model_routing.complexity_classifier || {}) };
    if (merged.model_routing.complexity_threshold == null) merged.model_routing.complexity_threshold = DEFAULT_CONFIG.model_routing.complexity_threshold;
    return merged;
  } catch (e) {
    return DEFAULT_CONFIG;
  }
}

/**
 * Merge updates into config and write to file. Shallow merge at top level; nested objects (e.g. gateway, model_routing) are merged one level deep.
 * @param {string} configPath - Full path to swarm_config.json
 * @param {Object} updates - Keys to merge (e.g. { gateway: { port: 8501, auth: { mode: 'token' } } })
 */
function writeConfig(configPath, updates) {
  const dir = configPath || path.join(process.cwd(), 'swarm_config.json');
  const current = loadConfig(dir);
  const merged = { ...current };
  for (const key of Object.keys(updates)) {
    const val = updates[key];
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      merged[key] = { ...(merged[key] || {}), ...val };
    } else {
      merged[key] = val;
    }
  }
  fs.writeFileSync(dir, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

module.exports = { loadConfig, writeConfig, DEFAULT_CONFIG };
