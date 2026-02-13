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

const ROOT = path.resolve(__dirname, '..');
const TELEGRAM_API = 'https://api.telegram.org/bot';
const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000; // 30 min

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
    const { checkAllSkills } = require('./tasks/skill-checker');
    const result = checkAllSkills(path.join(ROOT, 'skills'));
    if (result.invalid_skills > 0) log(`Heartbeat: ${result.invalid_skills} skills with invalid signature`);
  } catch (e) {}
}

/** Telegram poll + reply loop (same logic as cli.js telegram). */
async function runTelegramLoop() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const config = loadConfig(path.join(ROOT, 'swarm_config.json'));
  const model = config.model_routing?.tier_1_reasoning?.model || 'anthropic/claude-3.7-sonnet';
  const systemPrompt = 'You are Aether-Claw, a secure AI assistant. Be helpful and concise.';

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
          const chatId = msg.chat.id;
          const text = msg.text;
          try {
            const reply = await callLLM(
              { prompt: text, systemPrompt, model, max_tokens: 4096 },
              config
            );
            const out = (reply || '').slice(0, 4000);
            await sendTelegramMessage(token, String(chatId), out);
          } catch (e) {
            await sendTelegramMessage(token, String(chatId), 'Error: ' + (e.message || e));
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
  log('Gateway daemon starting (Node)');

  runHeartbeatTasks();
  setInterval(runHeartbeatTasks, HEARTBEAT_INTERVAL_MS);

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
