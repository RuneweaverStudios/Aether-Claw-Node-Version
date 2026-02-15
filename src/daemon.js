#!/usr/bin/env node
/**
 * Aether-Claw Node gateway daemon.
 * Long-lived process: heartbeat tasks (memory index, etc.) on an interval + Telegram bot.
 * Used by macOS LaunchAgent (com.aetherclaw.heartbeat); no Python required.
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const axios = require('axios');
const { loadConfig } = require('./config');
const { indexAll } = require('./brain');
const { sendTelegramMessage, sendChatAction } = require('./telegram-setup');
const { isFirstRun, getBootstrapFirstMessage } = require('./personality');
const { createReplyDispatcher, resolveSessionKey } = require('./gateway');
const { addPending } = require('./pairing');

const ROOT = path.resolve(__dirname, '..');
const TELEGRAM_API = 'https://api.telegram.org/bot';

function getHeartbeatIntervalMs() {
  try {
    const config = loadConfig(path.join(ROOT, 'swarm_config.json'));
    const min = config.heartbeat?.interval_minutes ?? 30;
    return Math.max(1, min) * 60 * 1000;
  } catch (e) {
    return 30 * 60 * 1000;
  }
}

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

/** Run heartbeat tasks (memory index, git scan, skill check) */
function runHeartbeatTasks() {
  try {
    const results = indexAll(ROOT);
    const count = Object.keys(results).length;
    log(`Heartbeat: indexed ${count} brain files`);
  } catch (e) {
    log('Heartbeat error: ' + (e.message || e));
  }
  try {
    const { scanAllRepositories } = require('./tasks/git-scanner');
    const repos = scanAllRepositories(ROOT);
    const withIssues = repos.filter(r => !r.is_clean);
    if (withIssues.length > 0) log(`Heartbeat: ${withIssues.length} repos with issues`);
  } catch (e) {
    // git not required
  }
  try {
    const { getAuditSummary } = require('./skill-audit');
    const summary = getAuditSummary(ROOT);
    if (summary.failed > 0) log(`Heartbeat: ${summary.failed} skills failed audit`);
  } catch (e) {}
}

/** Telegram poll + reply loop (OpenClaw-style: one reply dispatcher, agent loop with tools). */
async function runTelegramLoop() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const pairedChatId = process.env.TELEGRAM_CHAT_ID;
  if (!token) return;

  const replyDispatcher = createReplyDispatcher({ workspaceRoot: ROOT });
  const telegramChatsReceivedFirstReply = new Set();

  let offset = 0;
  while (true) {
    try {
      const url = offset
        ? `${TELEGRAM_API}${token}/getUpdates?offset=${offset}`
        : `${TELEGRAM_API}${token}/getUpdates`;
      const { data } = await axios.get(url, { timeout: 25000 });
      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          const msg = update.message;
          if (!msg || !msg.text) continue;
          const chatId = String(msg.chat.id);
          const text = (msg.text || '').trim();
          const isUnknownChat = !pairedChatId || chatId !== pairedChatId;
          if (isUnknownChat) {
            const code = String(Math.floor(100000 + Math.random() * 900000));
            addPending(ROOT, chatId, code);
            await sendTelegramMessage(token, chatId, `To pair with Aether-Claw, run in your terminal:\n\n\`aetherclaw pairing approve ${code}\`\n\nYour code: ${code}`);
            continue;
          }
          try {
            let out;
            const firstRun = isFirstRun(ROOT);
            if (firstRun && !telegramChatsReceivedFirstReply.has(chatId)) {
              out = getBootstrapFirstMessage();
              telegramChatsReceivedFirstReply.add(chatId);
            } else if (/^\d{6}$/.test(text)) {
              out = 'Already paired. Send me a message to chat with me.';
            } else {
              await sendChatAction(token, chatId, 'typing');
              const typingInterval = setInterval(() => {
                sendChatAction(token, chatId, 'typing').catch(() => {});
              }, 4000);
              try {
                const sessionKey = resolveSessionKey({ channel: 'telegram', chatId });
                const result = await replyDispatcher(sessionKey, text, { channel: 'telegram', chatId });
                out = (result.reply || result.error || '').slice(0, 4000);
              } finally {
                clearInterval(typingInterval);
              }
            }
            await sendTelegramMessage(token, chatId, out);
          } catch (e) {
            await sendTelegramMessage(token, chatId, 'Error: ' + (e.message || e));
          }
        }
      }
    } catch (e) {
      if (e.code !== 'ECONNABORTED') log('Telegram: ' + (e.message || e));
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main() {
  const intervalMs = getHeartbeatIntervalMs();
  log('Gateway daemon starting (Node), heartbeat every ' + (intervalMs / 60000) + ' min');

  runHeartbeatTasks();
  setInterval(runHeartbeatTasks, intervalMs);

  if (process.env.TELEGRAM_BOT_TOKEN) {
    log('Telegram bot enabled');
    await runTelegramLoop(); // never returns
  } else {
    log('No TELEGRAM_BOT_TOKEN; heartbeat only. Process staying alive.');
    setInterval(() => {}, 86400 * 1000); // keep process alive
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
