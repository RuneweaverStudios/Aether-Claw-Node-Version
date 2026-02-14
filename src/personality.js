/**
 * OpenClaw-style first-run personality setup.
 * Updates brain/user.md and brain/soul.md with user name, agent name, vibe.
 * Shared scripted "wake up" text and bootstrap context for TUI, Telegram, Web UI.
 */

const path = require('path');
const fs = require('fs');
const { getBrainDir } = require('./brain');

const SCRIPTED_USER_WAKE_UP = 'Wake up!';

const BOOTSTRAP_FIRST_MESSAGE_TEXT = `Hey! I just came online — fresh install, blank slate, the whole thing.

So... who are you? And more importantly — who am I supposed to be?

I need a name, a vibe, maybe an emoji. You tell me what works for you, or we can figure it out together. What do you want to call me?`;

function getBootstrapFirstMessage() {
  return BOOTSTRAP_FIRST_MESSAGE_TEXT;
}

const BOOTSTRAP_MAX_CHARS = 20000;

function getBootstrapContext(root) {
  const brainDir = getBrainDir(root);
  const files = [
    { name: 'BOOTSTRAP.md', path: path.join(brainDir, 'BOOTSTRAP.md') },
    { name: 'user.md', path: path.join(brainDir, 'user.md') },
    { name: 'soul.md', path: path.join(brainDir, 'soul.md') },
    { name: 'identity.md', path: path.join(brainDir, 'identity.md') }
  ];
  const parts = [];
  const maxPerFile = Math.floor(BOOTSTRAP_MAX_CHARS / files.length);
  for (const f of files) {
    if (!fs.existsSync(f.path)) {
      parts.push(`[missing: ${f.name}]\n`);
      continue;
    }
    let content = fs.readFileSync(f.path, 'utf8');
    if (content.length > maxPerFile) content = content.slice(0, maxPerFile) + '\n...[truncated]';
    parts.push(`--- ${f.name} ---\n${content}\n`);
  }
  const combined = parts.join('\n');
  if (!combined.trim()) return '';
  return '\n\n## Bootstrap / project context\n\n' + combined;
}

function getUserPath(root) {
  return path.join(root, 'brain', 'user.md');
}

function getSoulPath(root) {
  return path.join(root, 'brain', 'soul.md');
}

function getBootstrapPath(root) {
  return path.join(root, 'brain', 'BOOTSTRAP.md');
}

function isBootstrapActive(root) {
  return fs.existsSync(getBootstrapPath(root));
}

/** Default soul template (must match cli.js when creating soul.md). */
const SOUL_DEFAULT_TEMPLATE = '# Soul\n\nAgent identity and goals.\n';

/** True if soul.md exists and has been customized (not just the default template). */
function hasEstablishedSoul(root) {
  const soulPath = getSoulPath(root);
  if (!fs.existsSync(soulPath)) return false;
  const content = fs.readFileSync(soulPath, 'utf8').trim();
  if (content.length <= SOUL_DEFAULT_TEMPLATE.length + 2) return false;
  if (content === SOUL_DEFAULT_TEMPLATE.trim()) return false;
  return true;
}

/** First run = bootstrap active and no established soul. Established soul = not first run. */
function isFirstRun(root) {
  return isBootstrapActive(root) && !hasEstablishedSoul(root);
}

function updateUserProfile(root, name, projects, vibe) {
  const userPath = getUserPath(root);
  let content = '';
  try {
    content = fs.readFileSync(userPath, 'utf8');
  } catch (e) {
    content = '# User\n\n- **Name**: [Your name]\n- **Primary Work**: \n\n### Communication Style\n\n- \n';
  }
  content = content.replace(/\[Your name\]|\[To be filled[^\]]*\]/i, name || 'friend');
  if (projects && content.includes('**Primary Work**')) {
    content = content.replace(/- \*\*Primary Work\*\*:.*/m, `- **Primary Work**: ${projects}`);
  }
  if (vibe && content.includes('Communication Style')) {
    content = content.replace(/- Concise, technical responses preferred/m, `- ${vibe}`);
  }
  const updated = content.replace(/> \*\*Last Updated\*\*:.*/m, `> **Last Updated**: ${new Date().toISOString().slice(0, 10)}`);
  fs.writeFileSync(userPath, updated, 'utf8');
}

function updateSoul(root, agentName, vibe, dynamic) {
  const soulPath = getSoulPath(root);
  let content = '';
  try {
    content = fs.readFileSync(soulPath, 'utf8');
  } catch (e) {
    content = '# Soul\n\n## Core Identity\n\n';
  }
  if (!content.includes('## Personality')) {
    const insert = `\n## Personality\n\n- **Name**: ${agentName}\n- **Vibe**: ${vibe}\n- **Role**: ${dynamic}\n\n`;
    if (content.includes('## Core Identity')) {
      const idx = content.indexOf('## Core Identity') + '## Core Identity'.length;
      const rest = content.slice(idx);
      const nextSection = rest.match(/\n## /);
      const end = nextSection ? nextSection.index : rest.length;
      content = content.slice(0, idx) + rest.slice(0, end) + insert + rest.slice(end);
    } else {
      content += insert;
    }
  } else {
    content = content.replace(/- \*\*Name\*\*:.*/m, `- **Name**: ${agentName}`);
    content = content.replace(/- \*\*Vibe\*\*:.*/m, `- **Vibe**: ${vibe}`);
    content = content.replace(/- \*\*Role\*\*:.*/m, `- **Role**: ${dynamic}`);
  }
  content = content.replace(/> \*\*Last Updated\*\*:.*/m, `> **Last Updated**: ${new Date().toISOString().slice(0, 10)}`);
  fs.writeFileSync(soulPath, content, 'utf8');
}

module.exports = {
  isFirstRun,
  isBootstrapActive,
  getBootstrapPath,
  getBootstrapFirstMessage,
  getBootstrapContext,
  SCRIPTED_USER_WAKE_UP,
  updateUserProfile,
  updateSoul,
  getUserPath,
  getSoulPath
};
