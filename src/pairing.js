/**
 * Telegram pairing: pending store for unknown DMs. When an unknown user messages,
 * the daemon sends a code and adds it here. User runs: aetherclaw pairing approve <code>
 * to set TELEGRAM_CHAT_ID and complete pairing.
 */

const path = require('path');
const fs = require('fs');

const PENDING_FILENAME = 'telegram_pending.json';
const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 min

function getPendingPath(root) {
  const brainDir = path.join(root || process.cwd(), 'brain');
  if (!fs.existsSync(brainDir)) fs.mkdirSync(brainDir, { recursive: true });
  return path.join(brainDir, PENDING_FILENAME);
}

function readPending(root) {
  const p = getPendingPath(root);
  if (!fs.existsSync(p)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(data.pending) ? data.pending : [];
  } catch (e) {
    return [];
  }
}

function writePending(root, pending) {
  const p = getPendingPath(root);
  fs.writeFileSync(p, JSON.stringify({ pending }, null, 2), 'utf8');
}

/**
 * Add a pending pairing (chatId + code). Replaces any existing pending for this chatId.
 */
function addPending(root, chatId, code) {
  const pending = readPending(root).filter((e) => e.chatId !== chatId);
  pending.push({ chatId, code, at: new Date().toISOString() });
  writePending(root, pending);
}

/**
 * Find and remove a pending entry by code. Returns { chatId } or null if not found/expired.
 */
function consumePendingByCode(root, code) {
  const pending = readPending(root);
  const now = Date.now();
  const idx = pending.findIndex((e) => e.code === code);
  if (idx === -1) return null;
  const entry = pending[idx];
  const at = new Date(entry.at).getTime();
  if (now - at > CODE_EXPIRY_MS) {
    pending.splice(idx, 1);
    writePending(root, pending);
    return null; // expired
  }
  pending.splice(idx, 1);
  writePending(root, pending);
  return { chatId: entry.chatId };
}

/**
 * List pending pairings (for CLI list).
 */
function listPending(root) {
  const pending = readPending(root);
  const now = Date.now();
  return pending
    .filter((e) => now - new Date(e.at).getTime() <= CODE_EXPIRY_MS)
    .map((e) => ({ code: e.code, chatId: e.chatId, at: e.at }));
}

module.exports = { addPending, consumePendingByCode, listPending, getPendingPath };
