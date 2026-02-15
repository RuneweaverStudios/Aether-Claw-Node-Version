/**
 * Sync OpenClaw bundled skills from GitHub into workspace skills/.
 * Used by aetherclaw latest so users get 50+ skills after update.
 * Reserved skill names (Aether-Claw owned) are never overwritten.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const axios = require('axios');

const OPENCLAW_ARCHIVE_URL = 'https://github.com/openclaw/openclaw/archive/refs/heads/main.zip';
const ARCHIVE_ROOT = 'openclaw-main';

const RESERVED_SKILLS = ['cursor-agent', 'composio-twitter'];

/**
 * Download OpenClaw main archive and merge skills/ into workspaceRoot/skills/.
 * Skips reserved skill names (never overwrites cursor-agent, composio-twitter).
 * @param {string} workspaceRoot - Project root (contains skills/)
 * @param {{ reserved?: string[] }} opts - Reserved skill dirs (default: cursor-agent, composio-twitter)
 * @returns {Promise<number>} Number of skill dirs copied
 */
async function syncOpenClawSkills(workspaceRoot, opts = {}) {
  const reserved = new Set(opts.reserved || RESERVED_SKILLS);
  const skillsDir = path.join(workspaceRoot, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  const tmpDir = path.join(os.tmpdir(), 'aetherclaw-skills-sync-' + Date.now());
  const zipPath = path.join(tmpDir, 'main.zip');
  const extractDir = path.join(tmpDir, 'extract');

  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    const response = await axios.get(OPENCLAW_ARCHIVE_URL, {
      responseType: 'arraybuffer',
      timeout: 60000,
      maxContentLength: 100 * 1024 * 1024
    });

    fs.writeFileSync(zipPath, response.data);
    fs.mkdirSync(extractDir, { recursive: true });
    execSync(`unzip -q -o "${zipPath}" -d "${extractDir}"`, { stdio: 'pipe' });
    const srcSkills = path.join(extractDir, ARCHIVE_ROOT, 'skills');
    if (!fs.existsSync(srcSkills) || !fs.statSync(srcSkills).isDirectory()) {
      throw new Error('Archive missing skills/ directory');
    }
    const names = fs.readdirSync(srcSkills);
    let copied = 0;
    for (const name of names) {
      const srcPath = path.join(srcSkills, name);
      if (!fs.statSync(srcPath).isDirectory()) continue;
      if (reserved.has(name)) continue;
      const destPath = path.join(skillsDir, name);
      copyDirSync(srcPath, destPath);
      copied++;
    }
    return copied;
  } finally {
    try {
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
    } catch (_) {}
  }
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const srcItem = path.join(src, name);
    const destItem = path.join(dest, name);
    const stat = fs.statSync(srcItem);
    if (stat.isDirectory()) {
      copyDirSync(srcItem, destItem);
    } else {
      fs.copyFileSync(srcItem, destItem);
    }
  }
}

module.exports = { syncOpenClawSkills, RESERVED_SKILLS };
