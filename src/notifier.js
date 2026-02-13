/**
 * Aether-Claw Notifier (Node)
 * Log-based notifications; optional system notifications via optional dependency.
 */

const path = require('path');
const { logAction } = require('./audit-logger');

const LEVELS = { info: 'info', warning: 'warning', error: 'error', success: 'success' };

function _logToAudit(action, details, level = 'INFO', rootDir) {
  try {
    logAction(level, 'Notifier', action, details, null, rootDir);
  } catch (e) {
    // ignore
  }
}

function send(title, message, level = 'info', timeout = 10, rootDir = null) {
  const stats = { total_sent: 0, successful: 0, failed: 0 };
  stats.total_sent += 1;
  console.log(`[${(level || 'info').toUpperCase()}] ${title}: ${message}`);
  _logToAudit('NOTIFICATION', `${title}: ${message}`, 'INFO', rootDir);
  // Optional: use 'node-notifier' if installed for system tray notifications
  try {
    const notifier = require('node-notifier');
    notifier.notify({ title: `Aether-Claw: ${title}`, message, timeout });
    stats.successful += 1;
    return true;
  } catch (e) {
    stats.failed += 1;
    return true; // we still "succeeded" by logging
  }
}

function sendHeartbeatStatus(taskName, status, message, rootDir = null) {
  send('Heartbeat', `${taskName}: ${status} - ${message}`, status === 'failed' ? 'error' : 'info', 10, rootDir);
}

function getNotifier(rootDir = null) {
  return {
    send: (title, message, level, timeout) => send(title, message, level, timeout, rootDir),
    sendHeartbeatStatus: (taskName, status, message) => sendHeartbeatStatus(taskName, status, message, rootDir),
    getStats: getStats
  };
}

module.exports = { send, sendHeartbeatStatus, getNotifier, getStats, LEVELS };
