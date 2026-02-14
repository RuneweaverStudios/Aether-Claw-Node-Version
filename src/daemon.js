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
const { callLLM } = require('./api');
const { indexAll, getBrainDir } = require('./brain');
const { sendTelegramMessage } = require('./telegram-setup');
const { isFirstRun, getBootstrapFirstMessage, getBootstrapContext } = require('./personality');
const { buildSystemPromptWithSkills } = require('./openclaw-skills');

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

/** Telegram poll + reply loop (same logic as cli.js telegram). */
async function runTelegramLoop() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const pairedChatId = process.env.TELEGRAM_CHAT_ID;
  if (!token) return;

  const config = loadConfig(path.join(ROOT, 'swarm_config.json'));
  const model = config.model_routing?.tier_1_reasoning?.model || 'anthropic/claude-3.7-sonnet';
  const baseSystemPrompt = 'You are Aether-Claw, a secure AI assistant. Be helpful and concise.';
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
          if (pairedChatId && chatId !== pairedChatId) continue;
          try {
            let out;
            const firstRun = isFirstRun(ROOT);
            if (firstRun && !telegramChatsReceivedFirstReply.has(chatId)) {
              out = getBootstrapFirstMessage();
              telegramChatsReceivedFirstReply.add(chatId);
            } else if (/^\d{6}$/.test(text)) {
              out = 'Already paired. Send me a message to chat with me.';
            } else {
              let systemPrompt = baseSystemPrompt;
              if (firstRun) systemPrompt += getBootstrapContext(ROOT);
              systemPrompt = buildSystemPromptWithSkills(systemPrompt, ROOT);
              const reply = await callLLM(
                { prompt: text, systemPrompt, model, max_tokens: 4096 },
                config
              );
              out = (reply || '').slice(0, 4000);
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
