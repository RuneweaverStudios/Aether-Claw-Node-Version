/**
 * Telegram bot setup: ask for access token and chat ID (pairing), save to .env.
 */

const fs = require('fs');
const axios = require('axios');

const TELEGRAM_API = 'https://api.telegram.org/bot';

async function verifyBotToken(token) {
  try {
    const { data } = await axios.get(`${TELEGRAM_API}${token}/getMe`, { timeout: 10000 });
    if (data.ok && data.result) return { ok: true, bot: data.result };
    return { ok: false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function sendTelegramMessage(token, chatId, text) {
  try {
    const { data } = await axios.post(
      `${TELEGRAM_API}${token}/sendMessage`,
      { chat_id: chatId, text, parse_mode: 'Markdown' },
      { timeout: 10000 }
    );
    return data.ok === true;
  } catch (e) {
    return false;
  }
}

function appendOrReplaceEnv(envPath, key, value) {
  let content = '';
  if (fs.existsSync(envPath)) content = fs.readFileSync(envPath, 'utf8');
  const line = `${key}=${value}\n`;
  if (new RegExp(`^${key}=`, 'm').test(content)) {
    content = content.replace(new RegExp(`^${key}=.*`, 'm'), `${key}=${value}\n`);
  } else {
    content = content.trimEnd() + (content ? '\n' : '') + line;
  }
  fs.writeFileSync(envPath, content, 'utf8');
}

function hadTelegramBefore(envPath) {
  if (!envPath || !fs.existsSync(envPath)) return false;
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    return /^\s*TELEGRAM_BOT_TOKEN\s*=/m.test(content) || /^\s*TELEGRAM_CHAT_ID\s*=/m.test(content);
  } catch (e) {
    return false;
  }
}

/**
 * Run Telegram setup: ask for access token and chat ID (pairing), save to .env.
 * question(prompt, defaultVal), questionMasked(prompt) are async.
 * Options: { skipConnectPrompt: true } to skip "Connect? [y/N]" (e.g. when installer already asked).
 */
async function setupTelegram(envPath, { question, questionMasked }, options = {}) {
  console.log('\n  📱 Telegram Bot Setup');
  console.log('  ' + '─'.repeat(50));
  if (!options.skipConnectPrompt) {
    const wasReset = hadTelegramBefore(envPath);
    const prompt = wasReset ? '  Connect a new Telegram bot? [y/N]' : '  Set up Telegram bot? [y/N]';
    const doSetup = (await question(prompt, 'n')).trim().toLowerCase();
    if (doSetup !== 'y') {
      console.log('  ℹ Telegram setup skipped\n');
      return false;
    }
    console.log('');
  }
  let token = '';
  while (!token) {
    token = (await questionMasked('  Enter bot token: ')).trim();
    if (!token) {
      console.log('  ⚠ Token cannot be empty');
      continue;
    }
    console.log('  ⏳ Verifying token...');
    const result = await verifyBotToken(token);
    if (result.ok) {
      const u = result.bot.username || 'unknown';
      const n = result.bot.first_name || 'unknown';
      console.log('  ✓ Bot verified: ' + n + ' (@' + u + ')');
      break;
    }
    console.log('  ✗ Invalid token. Try again.');
    const retry = (await question('  Try again? [Y/n]', 'y')).trim().toLowerCase();
    if (retry === 'n') return false;
    token = '';
  }
  console.log('');
  console.log('  Chat ID = your Telegram chat with the bot. Get it by:');
  console.log('  • Send /start to your bot, then message @userinfobot, or');
  console.log('  • curl "https://api.telegram.org/bot<TOKEN>/getUpdates" after messaging the bot');
  console.log('');
  let chatId = (await question('  Enter Chat ID (pairing): ', '')).trim();
  if (!chatId) {
    console.log('  ℹ Skipped. Set TELEGRAM_CHAT_ID in .env later.\n');
    chatId = '';
  }
  console.log('\n  💾 Saving...');
  try {
    appendOrReplaceEnv(envPath, 'TELEGRAM_BOT_TOKEN', token);
    appendOrReplaceEnv(envPath, 'TELEGRAM_CHAT_ID', chatId);
    process.env.TELEGRAM_BOT_TOKEN = token;
    process.env.TELEGRAM_CHAT_ID = chatId;
    console.log('  ✓ Credentials saved to .env');
    if (chatId) console.log('  ✓ Chat ID: ' + chatId);
    console.log('  💡 Start the bot: node src/cli.js telegram\n');
    return true;
  } catch (e) {
    console.log('  ✗ Error saving: ' + e.message);
    console.log('  ℹ Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env manually\n');
    return false;
  }
}

module.exports = { setupTelegram, verifyBotToken, sendTelegramMessage };
