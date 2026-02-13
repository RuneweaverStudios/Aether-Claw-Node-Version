/**
 * Telegram bot setup for onboarding: verify token, wait for /start, pairing code, save to .env.
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
 * Run Telegram setup. ask(prompt, defaultVal), askMasked(prompt) are async.
 * Returns true if saved, false if skipped or failed.
 */
async function setupTelegram(envPath, { question, questionMasked }) {
  console.log('\n  [4/5] 📱 Telegram Bot Setup');
  console.log('  ' + '─'.repeat(50));
  const wasReset = hadTelegramBefore(envPath);
  if (wasReset) {
    console.log('  Telegram was reset. You can connect a new bot.\n');
  } else {
    console.log('  Connect Aether-Claw to Telegram:');
    console.log('  • Chat with your agent from anywhere');
    console.log('  • Receive notifications');
    console.log('  • Control your agent remotely');
    console.log('');
  }
  const prompt = wasReset ? '  Connect a new Telegram bot? [y/N]' : '  Set up Telegram bot? [y/N]';
  const doSetup = (await question(prompt, 'n')).trim().toLowerCase();
  if (doSetup !== 'y') {
    console.log('  ℹ Telegram setup skipped\n');
    return false;
  }
  console.log('');
  console.log('  📋 Step 1: Create a bot with BotFather');
  console.log('  1. Open Telegram and search for @BotFather');
  console.log('  2. Send /newbot to BotFather');
  console.log('  3. Choose a name (e.g. "My Aether-Claw")');
  console.log('  4. Choose a username ending in "bot"');
  console.log('  5. BotFather will give you a token.');
  console.log('');
  await question('  Press Enter when you have your bot token...', '');
  console.log('');
  let token = '';
  while (!token) {
    token = (await questionMasked('  Enter your bot token: ')).trim();
    if (!token) {
      console.log('  ⚠ Token cannot be empty');
      continue;
    }
    console.log('  ⏳ Verifying token...');
    const result = await verifyBotToken(token);
    if (result.ok) {
      const u = result.bot.username || 'unknown';
      const n = result.bot.first_name || 'unknown';
      console.log('  ✓ Bot verified: ' + n + ' (@' + u + ')\n');
      break;
    }
    console.log('  ✗ Invalid token. Please check and try again.');
    const retry = (await question('  Try again? [Y/n]', 'y')).trim().toLowerCase();
    if (retry === 'n') return false;
    token = '';
  }
  console.log('  📋 Step 2: Pair your bot');
  console.log('  1. Open Telegram and search for your bot');
  console.log('  2. Click Start or send /start to your bot');
  console.log('');
  console.log('  ⏳ Waiting for /start command... (up to 5 min)');
  const startResult = await waitForStart(token, 300000);
  if (!startResult) {
    console.log('\n  ✗ Timeout: did not receive /start');
    console.log('  ℹ Send /start to your bot and run onboard again if you want Telegram.\n');
    return false;
  }
  const { chatId, userName } = startResult;
  console.log('  ✓ Received /start from ' + userName);
  const pairingCode = generatePairingCode();
  const welcomeMsg = "👋 Hello! I'm Aether-Claw.\n\nTo complete pairing, send me this code:\n\n`" + pairingCode + "`\n\nThis code expires in 5 minutes.";
  if (await sendTelegramMessage(token, chatId, welcomeMsg)) {
    console.log('  ✓ Sent pairing code to bot');
  }
  console.log('\n  📝 Pairing code: ' + pairingCode);
  console.log('  ⏳ Waiting for you to send this code to your bot...');
  const paired = await waitForPairingCode(token, chatId, pairingCode, 300000);
  if (!paired) {
    console.log('\n  ✗ Pairing failed: code not received or timeout\n');
    return false;
  }
  console.log('  ✓ Pairing code verified!');
  const confirmMsg = "✅ Pairing successful!\n\nI'm connected to your Aether-Claw. You can chat with me here.";
  await sendTelegramMessage(token, chatId, confirmMsg);
  console.log('\n  💾 Saving credentials...');
  try {
    appendOrReplaceEnv(envPath, 'TELEGRAM_BOT_TOKEN', token);
    appendOrReplaceEnv(envPath, 'TELEGRAM_CHAT_ID', chatId);
    process.env.TELEGRAM_BOT_TOKEN = token;
    process.env.TELEGRAM_CHAT_ID = chatId;
    console.log('  ✓ Credentials saved to .env');
    console.log('  ✓ Chat ID: ' + chatId);
    console.log('  💡 Start the bot with: node src/cli.js telegram\n');
    return true;
  } catch (e) {
    console.log('  ✗ Error saving: ' + e.message);
    console.log('  ℹ Set manually: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env\n');
    return false;
  }
}

module.exports = { setupTelegram, verifyBotToken, sendTelegramMessage };
