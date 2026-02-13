const path = require('path');
const fs = require('fs');

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
      model: 'anthropic/claude-3.7-haiku',
      max_tokens: 2048,
      temperature: 0.5
    }
  },
  brain: { directory: 'brain' },
  safety_gate: { enabled: true }
};

function loadConfig(configPath) {
  const dir = configPath || path.join(process.cwd(), 'swarm_config.json');
  try {
    const raw = fs.readFileSync(dir, 'utf8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch (e) {
    return DEFAULT_CONFIG;
  }
}

module.exports = { loadConfig, DEFAULT_CONFIG };
