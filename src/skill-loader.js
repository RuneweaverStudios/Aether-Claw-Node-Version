/**
 * Aether-Claw Skill Loader (Node)
 * Load and verify skills; optional audit logging.
 */

const path = require('path');
const { listSkills, loadSkill } = require('./safe-skill-creator');
const { logAction } = require('./audit-logger');

const DEFAULT_SKILLS_DIR = path.join(path.resolve(__dirname, '..'), 'skills');

function loadSkillSafe(skillName, skillsDir = null, rootDir = null, autoLog = true) {
  const dir = skillsDir || DEFAULT_SKILLS_DIR;
  try {
    const skill = loadSkill(skillName, dir);
    if (autoLog && rootDir) {
      logAction('INFO', 'SkillLoader', 'skill_loaded', `Loaded skill: ${skillName}`, skill.signature_valid ? 'valid' : 'invalid', rootDir);
    }
    return skill;
  } catch (e) {
    if (autoLog && rootDir) logAction('WARN', 'SkillLoader', 'skill_load_failed', `${skillName}: ${e.message}`, null, rootDir);
    throw e;
  }
}

function listSkillsWithValidation(skillsDir = null) {
  return listSkills(skillsDir || DEFAULT_SKILLS_DIR);
}

module.exports = { loadSkillSafe, listSkills: listSkillsWithValidation, loadSkill };
