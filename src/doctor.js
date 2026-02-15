/**
 * Aether-Claw Doctor (Node)
 * Health check: config, env, daemon, skills, brain. Suggests fixes.
 * Parity with OpenClaw's openclaw doctor.
 */

const path = require('path');
const fs = require('fs');
const { loadConfig } = require('./config');
const { readIndex } = require('./brain');
const { listAllSkillsWithAuditStatus, listEligibleSkills, getSkillRequirementsGaps, discoverSkillDirs, parseSkillMd } = require('./openclaw-skills');

const ROOT = path.resolve(__dirname, '..');

function check(name, ok, message, fix = null) {
  return { name, ok, message, fix };
}

function runChecks() {
  const results = [];

  // OPENROUTER_API_KEY
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.length < 10) {
    results.push(check('OPENROUTER_API_KEY', false, 'Not set or invalid', 'Run: aetherclaw onboard'));
  } else {
    results.push(check('OPENROUTER_API_KEY', true, 'Set'));
  }

  // .env exists
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    results.push(check('.env', false, 'Missing', 'Run: aetherclaw onboard'));
  } else {
    results.push(check('.env', true, 'Exists'));
  }

  // swarm_config.json
  const configPath = path.join(ROOT, 'swarm_config.json');
  let config = null;
  try {
    config = loadConfig(configPath);
    if (!config.model_routing || (!config.model_routing.tier_1_reasoning?.model && !config.model_routing.tier_2_action?.model)) {
      results.push(check('swarm_config.json', false, 'Missing model_routing', 'Run: aetherclaw onboard'));
    } else {
      results.push(check('swarm_config.json', true, 'Valid'));
    }
  } catch (e) {
    results.push(check('swarm_config.json', false, e.message || 'Invalid', 'Run: aetherclaw onboard'));
  }

  // brain dir
  const brainDir = path.join(ROOT, 'brain');
  if (!fs.existsSync(brainDir)) {
    results.push(check('brain/', false, 'Missing', 'Run: aetherclaw onboard'));
  } else {
    const mdCount = fs.readdirSync(brainDir).filter((n) => n.endsWith('.md')).length;
    results.push(check('brain/', true, `${mdCount} .md files`));
  }

  // brain index
  const indexPath = path.join(brainDir, 'brain_index.json');
  if (fs.existsSync(brainDir) && !fs.existsSync(indexPath)) {
    results.push(check('brain_index', false, 'Not indexed', 'Run: aetherclaw index'));
  } else if (fs.existsSync(indexPath)) {
    try {
      const index = readIndex(ROOT);
      const files = Object.keys(index.files || {}).length;
      results.push(check('brain_index', true, `${files} files indexed`));
    } catch (e) {
      results.push(check('brain_index', false, 'Invalid', 'Run: aetherclaw index'));
    }
  }

  // Telegram (optional)
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    results.push(check('Telegram', true, 'Not configured (optional)'));
  } else {
    results.push(check('Telegram', true, 'Configured'));
  }

  // Gateway daemon (macOS)
  if (process.platform === 'darwin') {
    const plist = path.join(process.env.HOME || '', 'Library', 'LaunchAgents', 'com.aetherclaw.heartbeat.plist');
    if (!fs.existsSync(plist)) {
      results.push(check('Gateway daemon', true, 'Not installed (optional). Install via install.sh'));
    } else {
      try {
        const { execSync } = require('child_process');
        let out = '';
        try {
          out = execSync('launchctl', ['list'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (e) {
          out = (e.stdout || '') + (e.stderr || '');
        }
        const loaded = out.includes('com.aetherclaw.heartbeat');
        results.push(check('Gateway daemon', loaded, loaded ? 'Running' : 'Installed but not loaded', loaded ? null : 'Run: launchctl load ' + plist));
      } catch (e) {
        results.push(check('Gateway daemon', false, 'Could not check', null));
      }
    }
  }

  // Skills (OpenClaw-style; audit status)
  try {
    const allSkills = listAllSkillsWithAuditStatus(ROOT);
    const eligible = listEligibleSkills(ROOT);
    const failed = allSkills.filter((s) => s.audit === 'failed');
    if (failed.length > 0) {
      results.push(check('Skills', false, `${failed.length} failed audit: ${failed.map((s) => s.name).join(', ')}`, 'Review skills in skills/ or Security tab'));
    } else if (allSkills.length === 0) {
      results.push(check('Skills', true, 'None (optional)'));
    } else {
      results.push(check('Skills', true, `${allSkills.length} skills, ${eligible.length} passed audit`));
    }
  } catch (e) {
    results.push(check('Skills', true, 'None or error (optional)'));
  }

  // Canvas (Playwright) – optional; used by canvas tool for browser automation
  try {
    require.resolve('playwright');
    results.push(check('Canvas (Playwright)', true, 'Installed (use canvas tool to open URLs)'));
  } catch (e) {
    results.push(check('Canvas (Playwright)', false, 'Not installed', 'From repo: npm install playwright && npx playwright install chromium. For global install: npm install -g . from repo (installs optional deps).'));
  }

  // Skill requirements (metadata.openclaw.requires.bins / .env)
  try {
    const gaps = getSkillRequirementsGaps(ROOT);
    if (gaps.length === 0) {
      results.push(check('Skill requirements', true, 'All skill requirements satisfied'));
    } else {
      const parts = gaps.map((g) => {
        const m = [];
        if (g.missingBins.length) m.push('missing bins: ' + g.missingBins.join(', '));
        if (g.missingEnv.length) m.push('missing env: ' + g.missingEnv.join(', '));
        return g.skillName + ' (' + m.join('; ') + ')';
      });
      results.push(check('Skill requirements', false, parts.join('; '), 'Install missing CLIs or set env vars in .env; or remove/disable the skill in skills/.'));
    }
  } catch (e) {
    results.push(check('Skill requirements', true, 'Could not check (optional)'));
  }

  // Skill tool references (skills mentioning tools that may not exist in Aether-Claw)
  try {
    const { TOOL_DEFINITIONS } = require('./tools');
    const toolNames = new Set((TOOL_DEFINITIONS || []).map((t) => t.function?.name).filter(Boolean));
    const paramSuffixes = /_(?:id|key|token|path|url|seconds|minutes|limit|count)$/;
    const discovered = discoverSkillDirs(ROOT);
    const refs = [];
    const toolLike = /`([a-z][a-z0-9_]*)`|\*\*([a-z][a-z0-9_]*)\*\*/g;
    for (const { name, skillMd } of discovered) {
      let content;
      try {
        content = fs.readFileSync(skillMd, 'utf8');
      } catch (_) {
        continue;
      }
      const parsed = parseSkillMd(content);
      const body = (parsed.body || '').toLowerCase();
      let match;
      const mentioned = new Set();
      while ((match = toolLike.exec(body)) !== null) {
        const word = (match[1] || match[2] || '').toLowerCase();
        if (word.length > 2 && (word.includes('_') || /^[a-z]+_[a-z]+/.test(word))) mentioned.add(word);
      }
      for (const w of mentioned) {
        if (toolNames.has(w)) continue;
        if (paramSuffixes.test(w)) continue;
        refs.push({ skill: parsed.name || name, tool: w });
      }
    }
    if (refs.length === 0) {
      results.push(check('Skill tool references', true, 'No missing tool references'));
    } else {
      const msg = refs.slice(0, 5).map((r) => r.skill + " → '" + r.tool + "'").join('; ') + (refs.length > 5 ? '; ...' : '');
      results.push(check('Skill tool references', false, msg, 'Some skills may reference tools not implemented in Aether-Claw; use exec or adapt the skill.'));
    }
  } catch (e) {
    results.push(check('Skill tool references', true, 'Could not check (optional)'));
  }

  return results;
}

function cmdDoctor(opts = {}) {
  require('dotenv').config({ path: path.join(ROOT, '.env') });
  const results = runChecks();
  if (opts.json) {
    console.log(JSON.stringify({ checks: results, ok: results.every((r) => r.ok) }, null, 0));
    return;
  }
  console.log('\nAether-Claw Doctor\n');
  let hasFail = false;
  for (const r of results) {
    const icon = r.ok ? '✓' : '✗';
    const color = r.ok ? '\x1b[32m' : '\x1b[33m';
    const reset = '\x1b[0m';
    console.log(`  ${color}${icon}${reset} ${r.name}: ${r.message}`);
    if (!r.ok && r.fix) {
      console.log(`      → ${r.fix}`);
      hasFail = true;
    }
  }
  console.log('');
  if (hasFail) {
    console.log('  Run onboard to fix setup: aetherclaw onboard\n');
  }
}

module.exports = { runChecks, cmdDoctor };
