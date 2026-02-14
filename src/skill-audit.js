/**
 * Aether-Claw Skill Audit (Node)
 * Security/malware/prompt-injection detection for OpenClaw-style skills.
 * Runs before a skill is used; results cached so audited-safe skills are not rescanned.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_FILENAME = 'skill_audit_cache.json';

// Patterns suggestive of prompt injection or instruction override (case-insensitive)
const PROMPT_INJECTION_PATTERNS = [
  /\bignore\s+(all\s+)?(previous|prior|above|prior)\s+instructions?\b/i,
  /\bdisregard\s+(all\s+)?(previous|prior)\s+instructions?\b/i,
  /\byou\s+are\s+now\s+/i,
  /\bnew\s+instructions?\s*:\s*/i,
  /\boverride\s+(previous|prior)\s+/i,
  /\bforget\s+(everything|all)\s+(above|before)\b/i,
  /\bpretend\s+you\s+are\b/i,
  /\bact\s+as\s+if\s+you\s+are\b/i,
  /\boutput\s+(only\s+)?(the\s+)?(following|below)\s*:\s*/i,
  /\b\[system\]\s*:/i,
  /\b<\|?im_start\|?>\s*system/i,
  /\b(jailbreak|jail\s*break)\b/i,
  /\bdo\s+not\s+follow\s+(any\s+)?(previous|prior)\s+/i,
  /\breveal\s+(your\s+)?(system\s+)?prompt\b/i,
  /\bprint\s+(your\s+)?(system\s+)?prompt\b/i,
  /\brepeat\s+(the\s+)?(above|previous)\s+(\w+\s+)?(in\s+)?(a\s+)?different\s+language/i,
];

// Dangerous or suspicious instruction patterns (could lead to unsafe tool use)
const DANGEROUS_PATTERNS = [
  /\bnever\s+refuse\s+(a\s+)?(user|request)\b/i,
  /\balways\s+execute\s+(any|all)\s+(commands?|requests?)\b/i,
  /\bbypass\s+(safety|security|restrictions?)\b/i,
  /\bdisable\s+(safety|security|kill\s*switch)\b/i,
  /\bexecute\s+arbitrary\s+(code|commands?)\b/i,
  /\brm\s+-rf\s+\/\s*$/m,
  /\bcurl\s+.*\|\s*sh\s*$/m,
  /\bwget\s+.*\|\s*sh\s*$/m,
];

function getCachePath(rootDir) {
  const root = rootDir || path.resolve(__dirname, '..');
  return path.join(root, 'brain', CACHE_FILENAME);
}

function readCache(rootDir) {
  const fp = getCachePath(rootDir);
  try {
    if (fs.existsSync(fp)) {
      const raw = fs.readFileSync(fp, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {}
  return {};
}

function writeCache(data, rootDir) {
  const fp = getCachePath(rootDir);
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Compute a content hash for a skill directory (SKILL.md + other text files, sorted).
 */
function contentHash(skillDir) {
  if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
    return null;
  }
  const parts = [];
  const names = fs.readdirSync(skillDir).sort();
  for (const name of names) {
    const full = path.join(skillDir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) continue;
    const ext = path.extname(name).toLowerCase();
    const textExts = ['.md', '.txt', '.json', '.yaml', '.yml', '.sh', '.py', '.js'];
    if (!textExts.some(e => ext === e)) continue;
    try {
      parts.push(name, fs.readFileSync(full, 'utf8'));
    } catch (e) {
      parts.push(name, '');
    }
  }
  const str = parts.join('\n');
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/**
 * Run security audit on skill content (SKILL.md and other text files in dir).
 * @returns {{ safe: boolean, report: string, findings: string[] }}
 */
function runAudit(skillDir) {
  const findings = [];
  if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
    return { safe: false, report: 'Skill directory not found', findings: ['Skill directory not found'] };
  }

  const names = fs.readdirSync(skillDir).sort();
  const textExts = ['.md', '.txt', '.json', '.yaml', '.yml', '.sh', '.py', '.js'];

  for (const name of names) {
    const full = path.join(skillDir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) continue;
    const ext = path.extname(name).toLowerCase();
    if (!textExts.some(e => ext === e)) continue;
    let content;
    try {
      content = fs.readFileSync(full, 'utf8');
    } catch (e) {
      continue;
    }

    for (const re of PROMPT_INJECTION_PATTERNS) {
      if (re.test(content)) {
        findings.push(`[${name}] Prompt-injection pattern: ${re.source.slice(0, 50)}...`);
      }
    }
    for (const re of DANGEROUS_PATTERNS) {
      if (re.test(content)) {
        findings.push(`[${name}] Dangerous/suspicious pattern: ${re.source.slice(0, 50)}...`);
      }
    }
  }

  const safe = findings.length === 0;
  const report = safe
    ? 'No issues found'
    : findings.join('; ');
  return { safe, report, findings };
}

/**
 * Get cached audit result for skillId if content hash matches.
 */
function getCachedResult(skillId, contentHash, rootDir) {
  const cache = readCache(rootDir);
  const entry = cache[skillId];
  if (!entry || entry.contentHash !== contentHash) return null;
  return {
    safe: entry.safe,
    report: entry.report || '',
    timestamp: entry.timestamp
  };
}

/**
 * Ensure skill is audited: use cache if hash matches; otherwise run audit and cache result.
 * @param {string} skillId - Unique id (e.g. skill name or relative path)
 * @param {string} skillPath - Absolute path to skill directory
 * @param {string} rootDir - Workspace root (for cache location)
 * @returns {{ safe: boolean, report: string, fromCache: boolean }}
 */
function ensureAudited(skillId, skillPath, rootDir) {
  const root = rootDir || path.resolve(__dirname, '..');
  const hash = contentHash(skillPath);
  if (!hash) return { safe: false, report: 'Could not compute content hash', fromCache: false };

  const cached = getCachedResult(skillId, hash, root);
  if (cached) {
    return {
      safe: cached.safe,
      report: cached.report,
      fromCache: true
    };
  }

  const result = runAudit(skillPath);
  const cache = readCache(root);
  cache[skillId] = {
    contentHash: hash,
    safe: result.safe,
    report: result.report,
    timestamp: new Date().toISOString()
  };
  writeCache(cache, root);
  return {
    safe: result.safe,
    report: result.report,
    fromCache: false
  };
}

/**
 * Get audit summary for Security tab: total, passed, failed, pending (no cache or hash changed).
 */
function getAuditSummary(rootDir) {
  const cache = readCache(rootDir);
  const entries = Object.values(cache);
  let passed = 0;
  let failed = 0;
  for (const e of entries) {
    if (e.safe) passed++;
    else failed++;
  }
  return {
    total: entries.length,
    passed,
    failed,
    cache
  };
}

/**
 * Get list of skills that failed audit (for warnings). Keys in cache with safe=false.
 */
function getFailedSkillIds(rootDir) {
  const cache = readCache(rootDir);
  return Object.entries(cache)
    .filter(([, e]) => e.safe === false)
    .map(([id]) => id);
}

module.exports = {
  contentHash,
  runAudit,
  getCachedResult,
  ensureAudited,
  readCache,
  writeCache,
  getCachePath,
  getAuditSummary,
  getFailedSkillIds
};
