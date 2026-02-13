#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const chalk = require('chalk');
const { loadConfig } = require('./config');
const { callLLM } = require('./api');
const { runAgentLoop } = require('./agent-loop');
const { indexAll, getBrainDir, searchMemory, readIndex, indexFile } = require('./brain');
const { routePrompt } = require('./gateway');
const { isFirstRun, updateUserProfile, updateSoul } = require('./personality');
const { setupTelegram, sendTelegramMessage } = require('./telegram-setup');
const { listSkills: listSkillsFromLoader } = require('./safe-skill-creator');
const axios = require('axios');

const ROOT = path.resolve(__dirname, '..');
const TELEGRAM_API = 'https://api.telegram.org/bot';

function ttyQuestion(prompt, defaultVal = '') {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const p = defaultVal ? `${prompt} [${defaultVal}]: ` : `${prompt} `;
    rl.question(p, (answer) => {
      rl.close();
      resolve((answer && answer.trim()) || defaultVal);
    });
  });
}

/** Ask for input with masked echo (e.g. API key). Uses * per character. */
function ttyQuestionMasked(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    if (!stdin.isTTY) {
      return ttyQuestion(prompt).then(resolve);
    }
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let secret = '';
    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (ch) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        cleanup();
        stdout.write('\n');
        resolve(secret.trim());
        return;
      }
      if (ch === '\u0003') {
        cleanup();
        process.exit(130);
        return;
      }
      if (ch === '\u007f' || ch === '\b') {
        if (secret.length > 0) {
          secret = secret.slice(0, -1);
          stdout.write('\b \b');
        }
        return;
      }
      secret += ch;
      stdout.write('*');
    };
    stdin.on('data', onData);
  });
}

async function cmdOnboard() {
  console.log('\n  ' + chalk.cyan('╔════════════════════════════════════════════════════╗'));
  console.log('  ║              🥚 AETHERCLAW ONBOARDING 🥚             ║');
  console.log('  ╚════════════════════════════════════════════════════╝\n');

  let key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.log('  [1/5] 🔑 API Key');
    console.log('  Get your key at: https://openrouter.ai/keys');
    console.log('  (input is hidden; press Enter when done)\n');
    key = await ttyQuestionMasked('  Enter OpenRouter API key: ');
    if (key) {
      const envPath = path.join(ROOT, '.env');
      const line = `OPENROUTER_API_KEY=${key}\n`;
      if (fs.existsSync(envPath)) {
        let content = fs.readFileSync(envPath, 'utf8');
        if (/OPENROUTER_API_KEY=/.test(content)) {
          content = content.replace(/OPENROUTER_API_KEY=.*/m, `OPENROUTER_API_KEY=${key}`);
        } else {
          content += '\n' + line;
        }
        fs.writeFileSync(envPath, content);
      } else {
        fs.writeFileSync(envPath, line);
      }
      process.env.OPENROUTER_API_KEY = key;
      console.log('  ✓ API key saved to .env\n');
    }
  } else {
    console.log('  [1/5] 🔑 API Key: found in environment\n');
  }

  // [2/5] Model selection
  console.log('  [2/5] 🧠 Model selection');
  console.log('  ' + '─'.repeat(50));
  console.log('  PREMIUM REASONING:');
  console.log('  [1] Claude 3.7 Sonnet    $3/$15/M  - Best overall');
  console.log('  [2] Claude Opus 4.6      $5/$25/M  - Most powerful (1M ctx)');
  console.log('  [3] GLM 5                $0.80/$2.56/M - Z.AI flagship');
  console.log('  [4] Kimi K2.5            $0.45/$2.25/M - Visual coding');
  console.log('  [5] MiniMax M2.5         $0.30/$1.20/M - Office & coding');
  console.log('');
  console.log('  BALANCED:');
  console.log('  [6] Gemini 2.5 Pro       - Google\'s best');
  console.log('  [7] GPT-4.1              - OpenAI flagship');
  console.log('');
  console.log('  FAST/BUDGET:');
  console.log('  [8] Claude 3.7 Haiku     - Fast & cheap');
  console.log('  [9] Gemini 2.5 Flash     - Fast & efficient');
  console.log('  [0] DeepSeek V4          - Great value');
  console.log('');
  console.log('  SPECIAL:');
  console.log('  [A] MiniMax M2-her (Pony) - Roleplay/chat');
  console.log('  [B] Custom model (paste from openrouter.ai/models)');
  console.log('');
  const MODELS = {
    '1': ['anthropic/claude-3.7-sonnet', '$3/$15/M'],
    '2': ['anthropic/claude-opus-4.6', '$5/$25/M'],
    '3': ['z-ai/glm-5', '$0.80/$2.56/M'],
    '4': ['moonshotai/kimi-k2.5', '$0.45/$2.25/M'],
    '5': ['minimax/minimax-m2.5', '$0.30/$1.20/M'],
    '6': ['google/gemini-2.5-pro-preview', 'varies'],
    '7': ['openai/gpt-4.1', 'varies'],
    '8': ['anthropic/claude-3.7-haiku', '$0.80/$4/M'],
    '9': ['google/gemini-2.5-flash-preview', 'varies'],
    '0': ['deepseek/deepseek-chat-v4', 'budget'],
    'A': ['minimax/minimax-m2-her', '$0.30/$1.20/M']
  };
  let choice = (await ttyQuestion('  Select model [1-0,A,B] (default: 1)', '1')).trim().toUpperCase();
  let reasoningModel, modelLabel;
  if (choice === 'B') {
    console.log('\n  Open https://openrouter.ai/models and paste the model ID.\n');
    reasoningModel = (await ttyQuestion('  Paste model ID', 'anthropic/claude-3.7-sonnet')).trim() || 'anthropic/claude-3.7-sonnet';
    modelLabel = '(custom)';
  } else {
    const info = MODELS[choice] || MODELS['1'];
    reasoningModel = info[0];
    modelLabel = info[1];
  }
  console.log('  ✓ Reasoning: ' + reasoningModel + ' (' + modelLabel + ')\n');
  console.log('  Action model (for fast tasks):');
  const actionChoice = (await ttyQuestion('  [8] Haiku  [9] Flash  [0] DeepSeek  [Enter] Same as reasoning: ', '')).trim().toUpperCase();
  let actionModel;
  if (actionChoice && MODELS[actionChoice]) {
    actionModel = MODELS[actionChoice][0];
  } else if (actionChoice === 'B') {
    actionModel = (await ttyQuestion('  Paste action model ID', reasoningModel)).trim() || reasoningModel;
  } else {
    actionModel = reasoningModel;
  }
  console.log('  ✓ Action: ' + actionModel + '\n');
  const configPath = path.join(ROOT, 'swarm_config.json');
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (_) {}
  if (!config.model_routing) config.model_routing = {};
  if (!config.model_routing.tier_1_reasoning) config.model_routing.tier_1_reasoning = {};
  if (!config.model_routing.tier_2_action) config.model_routing.tier_2_action = {};
  config.model_routing.tier_1_reasoning.model = reasoningModel;
  config.model_routing.tier_2_action.model = actionModel;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  console.log('  ✓ Model config saved to swarm_config.json\n');

  console.log('  [3/5] 🧠 Brain');
  const brainDir = getBrainDir(ROOT);
  if (!fs.existsSync(path.join(brainDir, 'soul.md'))) {
    fs.writeFileSync(path.join(brainDir, 'soul.md'), '# Soul\n\nAgent identity and goals.\n', 'utf8');
    fs.writeFileSync(path.join(brainDir, 'user.md'), '# User\n\n- **Name**: [Your name]\n', 'utf8');
    fs.writeFileSync(path.join(brainDir, 'memory.md'), '# Memory\n\nLong-term memory log.\n', 'utf8');
    console.log('  ✓ Created brain/soul.md, user.md, memory.md\n');
  }
  const indexResults = indexAll(ROOT);
  console.log('  ✓ Indexed ' + Object.keys(indexResults).length + ' brain files\n');

  // [4/5] Telegram
  try {
    await setupTelegram(path.join(ROOT, '.env'), {
      question: ttyQuestion,
      questionMasked: ttyQuestionMasked
    });
  } catch (e) {
    console.log('  ⚠ Telegram setup skipped: ' + (e.message || e) + '\n');
  }

  console.log('  [5/5] ✅ Onboarding complete.\n');
  console.log('  ' + chalk.cyan('Ready to hatch!') + '\n');
  console.log('  [1] Hatch into TUI (terminal chat)');
  console.log('  [2] Hatch into Web UI (browser dashboard)');
  console.log('  [3] Exit (run manually later)\n');
  const hatch = (await ttyQuestion('  Choose [1-3] (default: 1)', '1')).trim();
  if (hatch === '2') {
    console.log('\n  🐣 Launching Web dashboard...\n');
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, [path.join(ROOT, 'src', 'dashboard.js')], {
      cwd: ROOT,
      stdio: 'inherit'
    });
    child.on('error', (err) => {
      console.log('  Could not start dashboard:', err.message);
      console.log('  Run: node src/cli.js dashboard\n');
    });
    await new Promise((res) => child.on('close', res));
  } else if (hatch !== '3') {
    console.log('\n  🐣 Hatching into TUI...\n');
    await cmdTui();
  } else {
    console.log('\n  Run later:');
    console.log('    ' + chalk.cyan('node src/cli.js tui') + '       # Terminal chat');
    console.log('    ' + chalk.cyan('node src/cli.js dashboard') + '   # Web dashboard');
    if (process.env.TELEGRAM_BOT_TOKEN) {
      console.log('    ' + chalk.dim('Telegram runs with the gateway daemon (install.sh → gateway).'));
    }
    console.log('');
  }
}

function dashboardCmd() {
  return 'node src/cli.js dashboard';
}

function cmdStatus() {
  const config = loadConfig(path.join(ROOT, 'swarm_config.json'));
  const index = readIndex(ROOT);
  const fileCount = Object.keys(index.files || {}).length;
  const skills = listSkills(ROOT);
  console.log(chalk.cyan('\nAether-Claw Status'));
  console.log('─'.repeat(50));
  console.log('Version: ', config.version);
  console.log('Brain:   ', path.join(ROOT, 'brain'));
  console.log('Indexed: ', fileCount, 'files');
  console.log('Skills:  ', skills.length, 'found');
  console.log('Safety:  ', config.safety_gate?.enabled ? 'ON' : 'OFF');
  const reasoning = config.model_routing?.tier_1_reasoning?.model;
  const action = config.model_routing?.tier_2_action?.model;
  if (reasoning) console.log('Reasoning:', reasoning);
  if (action) console.log('Action:   ', action);
  console.log('');
}

function listSkills(rootDir) {
  return listSkillsFromLoader(path.join(rootDir, 'skills')).map((s) => ({ name: s.name, signed: s.signature_valid }));
}

async function runPersonalitySetup() {
  console.log('\n  ' + chalk.green('✨ Wake up! ✨') + '\n');
  console.log('  First run — want to tell me about yourself? [Y/n]\n');
  const doSetup = (await ttyQuestion('  Set up personality?', 'y')).trim().toLowerCase();
  if (doSetup === 'n') {
    console.log('  No problem. You can chat anytime.\n');
    return false;
  }
  const userName = (await ttyQuestion('  What should I call you?', '')).trim() || 'friend';
  console.log('  Nice to meet you, ' + userName + '!\n');
  const agentName = (await ttyQuestion('  What should I be called? (or Enter for "Aether")', 'Aether')).trim() || 'Aether';
  console.log('  Got it — I\'m ' + agentName + '.\n');
  const vibe = (await ttyQuestion('  How should I sound? (e.g. helpful, witty, direct)', 'helpful')).trim() || 'helpful';
  const dynamic = (await ttyQuestion('  Our dynamic? (e.g. assistant, partner)', 'assistant')).trim() || 'assistant';
  const projects = (await ttyQuestion('  What do you work on?', '')).trim() || 'Software and engineering';
  updateUserProfile(ROOT, userName, projects, vibe);
  updateSoul(ROOT, agentName, vibe, dynamic);
  console.log('  ✓ Profile and personality saved. Ready when you are!\n');
  return true;
}

function cmdIndex(fileArg) {
  if (fileArg) {
    const version = indexFile(fileArg, ROOT);
    console.log('Indexed', fileArg, '→ version', version);
  } else {
    const results = indexAll(ROOT);
    console.log('Indexed', Object.keys(results).length, 'files:');
    Object.entries(results).forEach(([name, v]) => console.log('  ', name, '→ v' + v));
  }
}

async function cmdTui() {
  const config = loadConfig(path.join(ROOT, 'swarm_config.json'));
  const reasoningModel = config.model_routing?.tier_1_reasoning?.model || 'anthropic/claude-3.7-sonnet';
  const actionModel = config.model_routing?.tier_2_action?.model || 'anthropic/claude-3.7-haiku';

  console.log(chalk.blue('\n╔════════════════════════════════════════════════════╗'));
  console.log('║                 A E T H E R   C L A W                  ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  if (isFirstRun(ROOT)) {
    await runPersonalitySetup();
  }
  console.log('Type /help for commands, /quit to exit.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (prompt) => new Promise((res) => rl.question(prompt, res));

  const CHAT_SYSTEM = `You are Aether-Claw, a secure AI assistant with memory and skills. Be helpful and concise.`;
  const ACTION_SYSTEM = `You are an expert programmer with access to tools: exec (run shell commands in the project), process (manage background exec sessions), read_file, write_file, memory_search. Use these tools to run commands, read and write files, and search memory. Prefer running code and editing files via tools rather than only showing code in chat.`;
  const REFLECT_SYSTEM = `You are Aether-Claw. Help the user plan, break down problems, and think through options. Be structured and clear.`;

  while (true) {
    const line = await ask(chalk.cyan('> '));
    const input = (line || '').trim();
    if (!input) continue;

    if (input === '/quit' || input === '/exit' || input === '/q') {
      console.log(chalk.yellow('Goodbye!\n'));
      rl.close();
      process.exit(0);
    }
    if (input === '/help') {
      console.log('\n  /status  - system status (models, brain, skills)');
      console.log('  /memory <query> - search brain memory');
      console.log('  /skills  - list skills');
      console.log('  /index   - reindex brain files');
      console.log('  /clear   - clear screen');
      console.log('  /new, /reset - reset session (fresh context)');
      console.log('  /quit    - exit\n');
      continue;
    }
    if (input === '/status') {
      cmdStatus();
      continue;
    }
    if (input === '/clear') {
      console.clear();
      continue;
    }
    if (input === '/new' || input === '/reset') {
      console.log(chalk.dim('  Session reset. Next message starts fresh.\n'));
      continue;
    }
    if (input === '/skills') {
      const skills = listSkills(ROOT);
      if (skills.length === 0) console.log('\n  No skills in skills/\n');
      else {
        console.log('\n  Skills:');
        skills.forEach((s) => console.log('    ' + (s.signed ? '✓' : '○') + ' ' + s.name));
        console.log('');
      }
      continue;
    }
    if (input === '/index') {
      const results = indexAll(ROOT);
      console.log('\n  Indexed ' + Object.keys(results).length + ' files.\n');
      continue;
    }
    if (input.startsWith('/memory ')) {
      const q = input.slice(8).trim();
      const hits = searchMemory(q, ROOT, 5);
      console.log('\n  Results: ' + hits.length);
      hits.forEach((h, i) => console.log('  ' + (i + 1) + '. ' + h.file_name + ': ' + h.content.slice(0, 80) + '...'));
      console.log('');
      continue;
    }

    const { action, query } = routePrompt(input);
    let systemPrompt = CHAT_SYSTEM;
    let tier = 'reasoning';
    if (action === 'action') {
      systemPrompt = ACTION_SYSTEM;
      tier = 'action';
    } else if (action === 'reflect') {
      systemPrompt = REFLECT_SYSTEM;
      tier = 'reasoning';
    } else if (action === 'memory') {
      const hits = searchMemory(query, ROOT, 5);
      const memoryContext = hits.length
        ? 'Relevant memory:\n' + hits.map((h) => h.file_name + ': ' + h.content.slice(0, 200)).join('\n\n')
        : 'No matching memory.';
      systemPrompt = CHAT_SYSTEM + '\n\n' + memoryContext;
      tier = 'reasoning';
    }

    const label = action === 'action' ? chalk.dim(' [action]') : action === 'memory' ? chalk.dim(' [memory]') : action === 'reflect' ? chalk.dim(' [plan]') : '';
    console.log(chalk.dim('Thinking...') + label);
    try {
      let reply;
      if (action === 'action') {
        const result = await runAgentLoop(ROOT, query, systemPrompt, config, { tier: 'action', max_tokens: 4096 });
        reply = result.error ? result.error : result.reply;
        if (result.toolCallsCount) console.log(chalk.dim('  (used ' + result.toolCallsCount + ' tool calls)\n'));
      } else {
        reply = await callLLM(
          { prompt: query, systemPrompt, tier, max_tokens: 4096 },
          config
        );
      }
      console.log(chalk.green('\nAether-Claw:\n') + reply + '\n');
    } catch (e) {
      console.log(chalk.red('Error: ') + (e.message || e) + '\n');
    }
  }
}

async function cmdTelegramSetup() {
  const envPath = path.join(ROOT, '.env');
  const skipPrompt = process.argv.includes('--yes') || process.argv.includes('-y');
  await setupTelegram(envPath, {
    question: ttyQuestion,
    questionMasked: ttyQuestionMasked
  }, { skipConnectPrompt: skipPrompt });
}

async function cmdTelegram() {
  require('dotenv').config({ path: path.join(ROOT, '.env') });
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('Error: TELEGRAM_BOT_TOKEN not set. Run onboard to set up Telegram.');
    process.exit(1);
  }
  const config = loadConfig(path.join(ROOT, 'swarm_config.json'));
  const model = config.model_routing?.tier_1_reasoning?.model || 'anthropic/claude-3.7-sonnet';
  const systemPrompt = 'You are Aether-Claw, a secure AI assistant. Be helpful and concise.';
  console.log('Telegram bot running. Press Ctrl+C to stop.\n');
  let offset = 0;
  while (true) {
    try {
      const url = offset ? `${TELEGRAM_API}${token}/getUpdates?offset=${offset}` : `${TELEGRAM_API}${token}/getUpdates`;
      const { data } = await axios.get(url, { timeout: 25000 });
      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          const msg = update.message;
          if (!msg || !msg.text) continue;
          const chatId = msg.chat.id;
          const text = msg.text;
          const fromName = (msg.from && msg.from.first_name) || 'User';
          console.log('[' + chatId + '] ' + fromName + ': ' + text);
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
      if (e.code !== 'ECONNABORTED') console.error(e.message || e);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main() {
  const cmd = process.argv[2] || '';

  if (cmd === 'onboard') {
    await cmdOnboard();
    return;
  }
  if (cmd === 'status') {
    cmdStatus();
    return;
  }
  if (cmd === 'index') {
    cmdIndex(process.argv[3]);
    return;
  }
  if (cmd === 'tui') {
    await cmdTui();
    return;
  }
  if (cmd === 'telegram') {
    await cmdTelegram();
    return;
  }
  if (cmd === 'telegram-setup') {
    await cmdTelegramSetup();
    return;
  }
  if (cmd === 'daemon') {
    require('./daemon');
    return;
  }
  if (cmd === 'dashboard') {
    require('./dashboard');
    return;
  }
  if (cmd === 'doctor') {
    const { cmdDoctor } = require('./doctor');
    cmdDoctor();
    return;
  }

  console.log('Aether-Claw (Node)');
  console.log('  node src/cli.js onboard        - first-time setup');
  console.log('  node src/cli.js telegram-setup - connect or reconnect Telegram bot only');
  console.log('  node src/cli.js tui            - chat TUI (gateway routing)');
  console.log('  node src/cli.js telegram       - start Telegram bot only');
  console.log('  node src/cli.js daemon         - gateway daemon (heartbeat + Telegram)');
  console.log('  node src/cli.js dashboard      - web dashboard (status)');
  console.log('  node src/cli.js doctor         - health check and suggestions');
  console.log('  node src/cli.js status        - status');
  console.log('  node src/cli.js index         - index brain files (optional: <file>)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
