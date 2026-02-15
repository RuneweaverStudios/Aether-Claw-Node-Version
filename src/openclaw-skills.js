/**
 * Aether-Claw OpenClaw Skill Loader (Node)
 * Discover, parse, and format OpenClaw-style skills (SKILL.md directories).
 * Only returns skills that pass the security audit (cached or just audited).
 */

const fs = require('fs');
const path = require('path');
const { ensureAudited, contentHash } = require('./skill-audit');

const DEFAULT_SKILLS_DIR = 'skills';
const SKILL_MD = 'SKILL.md';

/**
 * Parse SKILL.md: YAML frontmatter (single-line keys) and body.
 * OpenClaw uses single-line keys; metadata can be single-line JSON.
 */
function parseSkillMd(content) {
  const out = { name: '', description: '', metadata: {}, body: '' };
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*([\s\S]*)$/);
  if (!match) {
    out.body = content.trim();
    return out;
  }
  const front = match[1].trim();
  out.body = (match[2] || '').trim();

  for (const line of front.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\"/g, '"');
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).replace(/\\'/g, "'");
    if (key === 'metadata') {
      try {
        out.metadata = JSON.parse(value);
      } catch (e) {
        out.metadata = {};
      }
    } else if (key === 'name') {
      out.name = value;
    } else if (key === 'description') {
      out.description = value;
    }
  }
  return out;
}

/**
 * Check optional gating: metadata.openclaw.requires (bins, env, config).
 * If requires is missing, skill is eligible. Otherwise check bins on PATH and env set.
 */
function passesGating(metadata, _rootDir) {
  const openclaw = metadata?.openclaw;
  if (!openclaw?.requires) return true;

  const req = openclaw.requires;
  if (req.bins && Array.isArray(req.bins)) {
    const pathEnv = (process.env.PATH || '').split(path.delimiter);
    for (const bin of req.bins) {
      const found = pathEnv.some(dir => {
        const p = path.join(dir, bin);
        try {
          return fs.existsSync(p);
        } catch (e) {
          return false;
        }
      });
      if (!found) return false;
    }
  }
  if (req.env && Array.isArray(req.env)) {
    for (const key of req.env) {
      const k = key.replace(/^["']|["']$/g, '');
      if (!process.env[k]) return false;
    }
  }
  return true;
}

/**
 * Discover all OpenClaw-style skills (subdirs of skillsDir containing SKILL.md).
 */
function discoverSkillDirs(workspaceRoot) {
  const root = workspaceRoot || path.resolve(__dirname, '..');
  const skillsDir = path.join(root, DEFAULT_SKILLS_DIR);
  const result = [];
  if (!fs.existsSync(skillsDir) || !fs.statSync(skillsDir).isDirectory()) {
    return result;
  }
  for (const name of fs.readdirSync(skillsDir)) {
    const dir = path.join(skillsDir, name);
    const skillMd = path.join(dir, SKILL_MD);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory() && fs.existsSync(skillMd)) {
      result.push({ dir, name, skillMd });
    }
  }
  return result;
}

/**
 * List eligible skills: discovered + gating + audit-passed only.
 * Each skill is audited (cached or fresh) before being included.
 */
function listEligibleSkills(workspaceRoot) {
  const root = workspaceRoot || path.resolve(__dirname, '..');
  const discovered = discoverSkillDirs(root);
  const eligible = [];

  for (const { dir, name, skillMd } of discovered) {
    let content;
    try {
      content = fs.readFileSync(skillMd, 'utf8');
    } catch (e) {
      continue;
    }
    const parsed = parseSkillMd(content);
    const skillName = parsed.name || name;
    if (!passesGating(parsed.metadata, root)) continue;

    const skillId = name;
    const audit = ensureAudited(skillId, dir, root);
    if (!audit.safe) continue;

    const skillMdPath = path.relative(root, path.join(dir, SKILL_MD));
    eligible.push({
      id: skillId,
      name: skillName,
      description: parsed.description || '',
      path: dir,
      skillMdPath,
      instructions: parsed.body
    });
  }

  return eligible;
}

/**
 * List all discovered skills with audit status (for doctor, Security tab).
 */
function listAllSkillsWithAuditStatus(workspaceRoot) {
  const root = workspaceRoot || path.resolve(__dirname, '..');
  const discovered = discoverSkillDirs(root);
  const list = [];

  for (const { dir, name, skillMd } of discovered) {
    let content;
    try {
      content = fs.readFileSync(skillMd, 'utf8');
    } catch (e) {
      list.push({ id: name, name, path: dir, audit: 'error', report: e.message });
      continue;
    }
    const parsed = parseSkillMd(content);
    const skillName = parsed.name || name;
    const audit = ensureAudited(name, dir, root);
    list.push({
      id: name,
      name: skillName,
      description: parsed.description || '',
      path: dir,
      audit: audit.safe ? 'passed' : 'failed',
      report: audit.report
    });
  }
  return list;
}

/**
 * Format eligible skills for injection into system prompt (OpenClaw-style).
 * Uses <available_skills> with name, description, location = path to SKILL.md (relative to workspace for read_file).
 */
function formatSkillsForPrompt(skills) {
  if (!skills || skills.length === 0) return '';
  const lines = skills.map(s => {
    const name = escapeXml(s.name);
    const desc = escapeXml((s.description || '').slice(0, 200));
    const loc = escapeXml(s.skillMdPath || s.path || s.id || '');
    return `<skill name="${name}" description="${desc}" location="${loc}">`;
  });
  return '\n<available_skills>\n' + lines.join('\n') + '\n</available_skills>\n\n' +
    'Before replying: scan the <available_skills> entries above. ' +
    'If exactly one skill clearly applies: read its SKILL.md at the given location with the read_file tool, then follow it. ' +
    'If multiple could apply: choose the most specific one, then read and follow it. ' +
    'If none clearly apply: do not read any SKILL.md.\n';
}

/**
 * Build workspace skill snapshot (OpenClaw-style): prompt + resolved skills for env/cache.
 * @param {string} workspaceRoot - Project root
 * @param {{ version?: string }} opts - Optional version for cache invalidation
 * @returns {{ prompt: string, skills: Array, resolvedSkills: Array, version: string }}
 */
function buildWorkspaceSkillSnapshot(workspaceRoot, opts = {}) {
  const root = workspaceRoot || path.resolve(__dirname, '..');
  const resolvedSkills = listEligibleSkills(root);
  const prompt = formatSkillsForPrompt(resolvedSkills);
  const version = opts.version || String(Date.now());
  return { prompt, skills: resolvedSkills, resolvedSkills, version };
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Build system prompt with eligible skills appended (uses snapshot for consistent format).
 */
function buildSystemPromptWithSkills(basePrompt, workspaceRoot) {
  const { prompt: skillsBlock } = buildWorkspaceSkillSnapshot(workspaceRoot);
  if (!skillsBlock) return basePrompt;
  return basePrompt + '\n\n## Skills\n\n' + skillsBlock;
}

/**
 * Check if a binary is on PATH (for doctor requirement checks).
 */
function isBinOnPath(bin) {
  const { execSync } = require('child_process');
  const check = process.platform === 'win32' ? (b) => `where ${b}` : (b) => `command -v ${b}`;
  try {
    execSync(check(bin), { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Return missing requirements per skill (for doctor). Only includes skills that declare requires and have at least one missing.
 * @param {string} workspaceRoot
 * @returns {{ skillId: string, skillName: string, missingBins: string[], missingEnv: string[] }[]}
 */
function getSkillRequirementsGaps(workspaceRoot) {
  const root = workspaceRoot || path.resolve(__dirname, '..');
  const discovered = discoverSkillDirs(root);
  const gaps = [];

  for (const { dir, name, skillMd } of discovered) {
    let content;
    try {
      content = fs.readFileSync(skillMd, 'utf8');
    } catch (_) {
      continue;
    }
    const parsed = parseSkillMd(content);
    const req = parsed.metadata?.openclaw?.requires;
    if (!req) continue;

    const missingBins = [];
    const missingEnv = [];

    if (req.bins && Array.isArray(req.bins)) {
      for (const bin of req.bins) {
        if (!isBinOnPath(bin)) missingBins.push(bin);
      }
    }
    if (req.env && Array.isArray(req.env)) {
      for (const key of req.env) {
        const k = String(key).replace(/^["']|["']$/g, '');
        if (!process.env[k]) missingEnv.push(k);
      }
    }

    if (missingBins.length || missingEnv.length) {
      gaps.push({
        skillId: name,
        skillName: parsed.name || name,
        missingBins,
        missingEnv
      });
    }
  }
  return gaps;
}

module.exports = {
  discoverSkillDirs,
  listEligibleSkills,
  listAllSkillsWithAuditStatus,
  formatSkillsForPrompt,
  buildWorkspaceSkillSnapshot,
  buildSystemPromptWithSkills,
  parseSkillMd,
  passesGating,
  getSkillRequirementsGaps,
  isBinOnPath
};
