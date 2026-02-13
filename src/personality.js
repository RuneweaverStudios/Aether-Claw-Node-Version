/**
 * OpenClaw-style first-run personality setup.
 * Updates brain/user.md and brain/soul.md with user name, agent name, vibe.
 */

const path = require('path');
const fs = require('fs');

function getUserPath(root) {
  return path.join(root, 'brain', 'user.md');
}

function getSoulPath(root) {
  return path.join(root, 'brain', 'soul.md');
}

function isFirstRun(root) {
  const userPath = getUserPath(root);
  if (!fs.existsSync(userPath)) return true;
  try {
    const content = fs.readFileSync(userPath, 'utf8');
    if (/\[Your name\]|\[To be filled|To be filled by user/i.test(content)) return true;
    if (/\*\*Name\*\*:\s*$/m.test(content)) return true;
    return false;
  } catch (e) {
    return true;
  }
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

module.exports = { isFirstRun, updateUserProfile, updateSoul, getUserPath, getSoulPath };
