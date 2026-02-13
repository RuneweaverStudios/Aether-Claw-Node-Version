/**
 * Aether-Claw Safety Gate (Node)
 * Permission checking and optional confirmation for sensitive actions.
 */

const path = require('path');
const { loadConfig } = require('./config');

const ActionCategory = {
  FILE_READ: 'file_read',
  FILE_WRITE: 'file_write',
  FILE_DELETE: 'file_delete',
  NETWORK_REQUEST: 'network_request',
  SYSTEM_COMMAND: 'system_command',
  SKILL_CREATION: 'skill_creation',
  SKILL_LOADING: 'skill_loading',
  GIT_OPERATIONS: 'git_operations',
  MEMORY_MODIFICATION: 'memory_modification',
  CONFIG_CHANGE: 'config_change',
  NOTIFICATION: 'notification',
  AUDIT_READ: 'audit_read'
};

function requiresConfirmation(rootDir, category) {
  try {
    const configPath = path.join(rootDir || path.resolve(__dirname, '..'), 'swarm_config.json');
    const config = loadConfig(configPath);
    const sg = config.safety_gate || {};
    if (sg.enabled === false) return false;
    const req = sg.confirmation_required || {};
    return req[category] === true;
  } catch (e) {
    return false;
  }
}

function checkPermission(category, _context = null, rootDir = null, confirmationHandler = null) {
  const unsafe = ['1', 'true', 'yes'].includes((process.env.AETHER_UNSAFE_MODE || '').toLowerCase());
  if (unsafe) return { allowed: true, reason: 'unsafe_mode', requires_confirmation: false };

  const needConfirm = requiresConfirmation(rootDir, category);
  if (!needConfirm) return { allowed: true, reason: 'allowed', requires_confirmation: false };

  const msg = `Confirm: ${category}?`;
  const handler = confirmationHandler || (() => false);
  const granted = handler(msg);
  return {
    allowed: granted,
    reason: granted ? 'confirmed' : 'denied',
    requires_confirmation: true,
    confirmation_message: msg
  };
}

module.exports = { ActionCategory, requiresConfirmation, checkPermission };
