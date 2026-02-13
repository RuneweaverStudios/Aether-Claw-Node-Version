/**
 * Aether-Claw Skill Integrity Checker (Node)
 */

const path = require('path');
const { listSkills } = require('../safe-skill-creator');

function checkAllSkills(skillsDir = null) {
  const skills = listSkills(skillsDir || path.join(path.resolve(__dirname, '..', '..'), 'skills'));
  let valid = 0;
  let invalid = 0;
  let unsigned = 0;
  const results = skills.map(s => {
    if (s.error) unsigned += 1;
    else if (s.signature_valid) valid += 1;
    else invalid += 1;
    return { skill_name: s.name, signature_valid: s.signature_valid, is_signed: s.is_signed, error: s.error };
  });
  return { total_skills: skills.length, valid_skills: valid, invalid_skills: invalid, unsigned_skills: unsigned, skills: results };
}

function triggerOnFailure(result) {
  return result.invalid_skills > 0;
}

module.exports = { checkAllSkills, triggerOnFailure };
