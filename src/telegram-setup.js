/**
 * Telegram bot setup: token + pairing code (send /start, reply with code from bot).
 */

const fs = require('fs');
const axios = require('axios');

const TELEGRAM_API = 'https://api.telegram.org/bot';

function generatePairingCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

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

async function sendChatAction(token, chatId, action) {
  try {
    const { data } = await axios.post(
      `${TELEGRAM_API}${token}/sendChatAction`,
      { chat_id: chatId, action },
      { timeout: 5000 }
    );
    return data.ok === true;
  } catch (e) {
    return false;
  }
}

async function waitForStart(token, timeoutMs = 300000) {
  const step = 2000;
  let offset = 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const url = offset ? `${TELEGRAM_API}${token}/getUpdates?offset=${offset}` : `${TELEGRAM_API}${token}/getUpdates`;
      const { data } = await axios.get(url, { timeout: 15000 });
      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          const msg = update.message;
          if (msg && msg.chat && (msg.text || '').trim() === '/start') {
            return { chatId: String(msg.chat.id), userName: (msg.from && msg.from.first_name) || 'User' };
          }
        }
      }
    } catch (e) {
      // ignore
    }
    await new Promise((r) => setTimeout(r, step));
  }
  return null;
}

async function waitForPairingCode(token, chatId, code, timeoutMs = 300000) {
  const step = 2000;
  let offset = 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const url = offset ? `${TELEGRAM_API}${token}/getUpdates?offset=${offset}` : `${TELEGRAM_API}${token}/getUpdates`;
      const { data } = await axios.get(url, { timeout: 15000 });
      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          const msg = update.message;
          if (msg && String(msg.chat.id) === chatId && (msg.text || '').trim() === code) {
            return true;
          }
        }
      }
    } catch (e) {
      // ignore
    }
    await new Promise((r) => setTimeout(r, step));
  }
  return false;
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
 * Run Telegram setup: token, then send /start to bot → bot sends pairing code → reply with code → save.
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
  console.log('  📋 Get a bot token from BotFather:');
  console.log('  1. Open Telegram and search for @BotFather');
  console.log('  2. Send /newbot to BotFather');
  console.log('  3. Choose a name (e.g. "My Aether-Claw")');
  console.log('  4. Choose a username (must end in "bot", e.g. my_aetherclaw_bot)');
  console.log('  5. BotFather will give you a token.');
  console.log('');
  await question('  Press Enter when you have your bot token...', '');
  console.log('');
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
  console.log('  📋 Pair your bot:');
  console.log('  1. Open Telegram and search for your bot');
  console.log('  2. Send /start to your bot');
  console.log('');
  console.log('  ⏳ Waiting for /start... (up to 5 min)');
  const startResult = await waitForStart(token, 300000);
  if (!startResult) {
    console.log('\n  ✗ Timeout: did not receive /start. Send /start to your bot and try again.\n');
    return false;
  }
  const { chatId, userName } = startResult;
  console.log('  ✓ Received /start from ' + userName);
  const pairingCode = generatePairingCode();
  const welcomeMsg = "👋 Hello! I'm Aether-Claw.\n\nTo complete pairing, **reply to this chat with this code:**\n\n`" + pairingCode + "`\n\n(Code expires in 5 min)";
  if (await sendTelegramMessage(token, chatId, welcomeMsg)) {
    console.log('  ✓ Sent pairing code to your bot');
  }
  console.log('\n  📝 Pairing code: ' + pairingCode);
  console.log('  ⏳ Reply to your bot in Telegram with this code...');
  const paired = await waitForPairingCode(token, chatId, pairingCode, 300000);
  if (!paired) {
    console.log('\n  ✗ Pairing failed: code not received or timeout.\n');
    return false;
  }
  console.log('  ✓ Pairing code verified!');
  await sendTelegramMessage(token, chatId, "✅ Pairing successful! I'm connected to your Aether-Claw.");
  await sendTelegramMessage(token, chatId, "📌 _Replies when the gateway daemon is running._ Install or restart it: run `install.sh` → choose gateway install/restart.");
  console.log('\n  💾 Saving...');
  try {
    appendOrReplaceEnv(envPath, 'TELEGRAM_BOT_TOKEN', token);
    appendOrReplaceEnv(envPath, 'TELEGRAM_CHAT_ID', chatId);
    process.env.TELEGRAM_BOT_TOKEN = token;
    process.env.TELEGRAM_CHAT_ID = chatId;
    console.log('  ✓ Credentials saved to .env');
    console.log('\n  Telegram runs with the gateway daemon (install.sh → install or restart gateway).');
    console.log('  Or run manually: aetherclaw telegram\n');
    return true;
  } catch (e) {
    console.log('  ✗ Error saving: ' + e.message);
    console.log('  ℹ Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env manually\n');
    return false;
  }
}

module.exports = { setupTelegram, verifyBotToken, sendTelegramMessage, sendChatAction, appendOrReplaceEnv };
