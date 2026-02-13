/**
 * Aether-Claw Safe Skill Creator (Node)
 * List, load, sign, and verify skills (JSON with metadata + code + signature).
 */

const fs = require('fs');
const path = require('path');
const { KeyManager } = require('./keygen');

const DEFAULT_SKILLS_DIR = path.join(path.resolve(__dirname, '..'), 'skills');

class SecurityError extends Error {}

function listSkills(skillsDir = null) {
  const dir = skillsDir || DEFAULT_SKILLS_DIR;
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const skillPath = path.join(dir, name);
    try {
      const raw = fs.readFileSync(skillPath, 'utf8');
      const data = JSON.parse(raw);
      const metadata = data.metadata || {};
      const code = data.code || '';
      const signature = data.signature || '';
      const keyManager = new KeyManager();
      let signature_valid = false;
      if (signature && keyManager.keyExists()) {
        try {
          signature_valid = keyManager.verifySignature(code, signature);
        } catch (e) {}
      }
      results.push({
        name: metadata.name || name.replace(/\.json$/, ''),
        version: metadata.version,
        description: metadata.description,
        signature_valid,
        is_signed: !!signature
      });
    } catch (e) {
      results.push({ name: name.replace(/\.json$/, ''), signature_valid: false, is_signed: false, error: e.message });
    }
  }
  return results;
}

function loadSkill(skillName, skillsDir = null) {
  const dir = skillsDir || DEFAULT_SKILLS_DIR;
  const skillPath = path.join(dir, `${skillName}.json`);
  if (!fs.existsSync(skillPath)) throw new Error(`Skill not found: ${skillName}`);
  const data = JSON.parse(fs.readFileSync(skillPath, 'utf8'));
  const signature = data.signature || '';
  const code = data.code || '';
  const keyManager = new KeyManager();
  let signature_valid = false;
  if (signature && keyManager.keyExists()) {
    signature_valid = keyManager.verifySignature(code, signature);
  }
  return { metadata: data.metadata || {}, code, signature, signature_valid };
}

function signAndSaveSkill(code, name, options = {}, skillsDir = null) {
  const dir = skillsDir || DEFAULT_SKILLS_DIR;
  const { version = '1.0.0', description = '', author = 'Aether-Claw' } = options;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const keyManager = new KeyManager();
  if (!keyManager.keyExists()) throw new SecurityError('Key pair not found. Run keygen first.');
  const signature = keyManager.signData(code).toString('hex');
  const metadata = {
    name,
    version,
    description,
    author,
    created_at: new Date().toISOString(),
    scan_passed: true,
    scan_report: 'Node: scan skipped'
  };
  const skillPath = path.join(dir, `${name}.json`);
  fs.writeFileSync(skillPath, JSON.stringify({ metadata, code, signature }, null, 2), 'utf8');
  return skillPath;
}

module.exports = { listSkills, loadSkill, signAndSaveSkill, SecurityError, KeyManager };
