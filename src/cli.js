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
const { isFirstRun, updateUserProfile, updateSoul, getBootstrapFirstMessage, getBootstrapContext, SCRIPTED_USER_WAKE_UP } = require('./personality');
const { setupTelegram, sendTelegramMessage, sendChatAction } = require('./telegram-setup');
const { buildSystemPromptWithSkills, listAllSkillsWithAuditStatus, listEligibleSkills } = require('./openclaw-skills');
const axios = require('axios');

const ROOT = path.resolve(__dirname, '..');
const TELEGRAM_API = 'https://api.telegram.org/bot';

const ONBOARD_STEPS_TOTAL = 6;

const BANNER = `
╔════════════════════════════════════════════════════╗
║                A E T H E R C L A W                 ║
║  ───────────────────────────────────────────────  ║
║     Secure Swarm-Based Second Brain / Agent        ║
║  Local • Cryptographically Signed Skills • Memory  ║
╚════════════════════════════════════════════════════╝

   █████╗ ███████╗████████╗██╗  ██╗███████╗██████╗ 
  ██╔══██╗██╔════╝╚══██╔══╝██║  ██║██╔════╝██╔══██╗
  ███████║█████╗     ██║   ███████║█████╗  ██████╔╝
  ██╔══██║██╔══╝     ██║   ██╔══██║██╔══╝  ██╔══██╗
  ██║  ██║███████╗   ██║   ██║  ██║███████╗██║  ██║
  ╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
`;

function printBanner(color = chalk.blue) {
  console.log(color(BANNER));
}

function renderProgress(step, total, label) {
  const n = Math.min(step, total);
  const barLen = 10;
  const filled = Math.round((n / total) * barLen);
  const bar = '[' + '='.repeat(filled) + '>'.repeat(filled < barLen ? 1 : 0) + ' '.repeat(barLen - filled - (filled < barLen ? 1 : 0)) + ']';
  console.log('\n  ' + chalk.cyan(bar) + ' ' + chalk.dim(n + '/' + total) + '  ' + chalk.bold(label) + '\n');
}

const BOOTSTRAP_MD_CONTENT = `# BOOTSTRAP - First-run ritual

You just woke up. The user already saw your intro. Now continue the conversation.

Figure out together:
1. **Your name** — What should they call you?
2. **Your nature** — What kind of creature are you? (AI assistant is fine, or something weirder)
3. **Your vibe** — Formal? Casual? Snarky? Warm? What feels right?
4. **Your emoji** — Everyone needs a signature.

Update these files with what you learn:
- \`brain/identity.md\` — your name, creature, vibe, emoji (create if missing)
- \`brain/user.md\` — their name, what to call them, timezone, notes
- \`brain/soul.md\` — what matters to them, how they want you to behave, boundaries

When you are done, use the delete_file tool to remove \`brain/BOOTSTRAP.md\` so this ritual only runs once.
`;

function seedBootstrapIfNeeded(root) {
  const brainDir = getBrainDir(root);
  const bootstrapPath = path.join(brainDir, 'BOOTSTRAP.md');
  if (fs.existsSync(bootstrapPath)) return;
  fs.writeFileSync(bootstrapPath, BOOTSTRAP_MD_CONTENT, 'utf8');
  console.log('  ✓ Created brain/BOOTSTRAP.md (first-run conversation)\n');
}

/** Read stdin to end (for piping: echo "task" | node src/cli.js code). */
function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(chunks.join('').trim()));
  });
}

const PLANNING_SYSTEM = `You are a coding task planner. Given a user request, produce a clear, ordered plan (numbered steps) only. Include: which files to create or edit, which commands to run, and any checks or tests to add. Output the plan in markdown. Do not write implementation code or code blocks—only the plan.`;
const CODE_BUILD_SYSTEM = `You are an expert programmer with access to tools: exec (run shell commands in the project), process (manage background exec sessions), read_file, write_file, memory_search. Use these tools to run commands, read and write files, and search memory. Execute the following plan step by step using your tools. Do not only describe—make the edits and run commands as needed.`;

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
  printBanner(chalk.cyan);
  console.log(chalk.cyan('  🥚 ONBOARDING\n'));

  renderProgress(1, ONBOARD_STEPS_TOTAL, 'API Key');
  let key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.log('  [1/6] 🔑 API Key');
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
    console.log('  [1/6] 🔑 API Key: found in environment\n');
  }

  renderProgress(2, ONBOARD_STEPS_TOTAL, 'Model selection');
  // [2/6] Model selection
  console.log('  [2/6] 🧠 Model selection');
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

  renderProgress(3, ONBOARD_STEPS_TOTAL, 'Brain');
  console.log('  [3/6] 🧠 Brain');
  const brainDir = getBrainDir(ROOT);
  if (!fs.existsSync(path.join(brainDir, 'soul.md'))) {
    fs.writeFileSync(path.join(brainDir, 'soul.md'), '# Soul\n\nAgent identity and goals.\n', 'utf8');
    fs.writeFileSync(path.join(brainDir, 'user.md'), '# User\n\n- **Name**: [Your name]\n', 'utf8');
    fs.writeFileSync(path.join(brainDir, 'memory.md'), '# Memory\n\nLong-term memory log.\n', 'utf8');
    console.log('  ✓ Created brain/soul.md, user.md, memory.md\n');
  }
  seedBootstrapIfNeeded(ROOT);
  const indexResults = indexAll(ROOT);
  console.log('  ✓ Indexed ' + Object.keys(indexResults).length + ' brain files\n');

  renderProgress(4, ONBOARD_STEPS_TOTAL, 'Telegram');
  console.log('  [4/6] Telegram');
  try {
    await setupTelegram(path.join(ROOT, '.env'), {
      question: ttyQuestion,
      questionMasked: ttyQuestionMasked
    });
  } catch (e) {
    console.log('  ⚠ Telegram setup skipped: ' + (e.message || e) + '\n');
  }

  renderProgress(5, ONBOARD_STEPS_TOTAL, 'Gateway');
  console.log('  [5/6] 🚪 Gateway');
  if (process.platform === 'darwin') {
    try {
      const { runGatewaySetup } = require('./gateway-install');
      await runGatewaySetup(ROOT, { ttyQuestion });
    } catch (e) {
      console.log('  ⚠ Gateway setup skipped: ' + (e.message || e) + '\n');
    }
  } else {
    console.log('  To run the gateway daemon: ' + chalk.cyan('node src/daemon.js') + '\n');
  }

  renderProgress(6, ONBOARD_STEPS_TOTAL, 'Complete');
  console.log('  [6/6] ✅ Onboarding complete.\n');
  console.log('  ' + chalk.cyan('Ready to hatch!') + '\n');
  console.log('  [1] Hatch into TUI (terminal chat)');
  console.log('  [2] Hatch into Web UI (browser dashboard)');
  console.log('  [3] Hatch in Telegram (connect bot)');
  console.log('  [4] Exit (run manually later)\n');
  const hatch = (await ttyQuestion('  Choose [1-4] (default: 1)', '1')).trim();
  if (hatch !== '4') {
    try {
      const { ensureGatewayBeforeLaunch } = require('./gateway-install');
      await ensureGatewayBeforeLaunch(ROOT, { ttyQuestion });
    } catch (e) {
      // do not block launch
    }
  }
  if (hatch === '2') {
    const { spawn } = require('child_process');
    const port = Number(process.env.PORT) || 8501;
    const url = `http://localhost:${port}`;
    console.log('\n  🐣 Launching Web dashboard...\n');
    const child = spawn(process.execPath, [path.join(ROOT, 'src', 'dashboard.js')], {
      cwd: ROOT,
      stdio: [null, 'inherit', 'inherit'],
      env: { ...process.env, PORT: String(port) }
    });
    child.on('error', (err) => {
      console.log('  Could not start dashboard:', err.message);
      console.log('  Run: node src/cli.js dashboard\n');
    });
    const openBrowser = () => {
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      try {
        require('child_process').execSync(`${cmd} "${url}"`, { stdio: 'ignore' });
      } catch (_) {}
    };
    setTimeout(() => {
      console.log('  Dashboard: ' + chalk.cyan(url));
      console.log('  Opening browser...');
      openBrowser();
      console.log('  Press Enter to open in browser again, or Ctrl+C to stop the server.\n');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.on('line', () => { openBrowser(); });
    }, 1800);
    await new Promise((res) => child.on('close', res));
  } else if (hatch === '3') {
    console.log('\n  🐣 Hatch in Telegram...\n');
    require('dotenv').config({ path: path.join(ROOT, '.env') });
    if (process.env.TELEGRAM_BOT_TOKEN) {
      console.log('  Telegram is already connected. Run the gateway to receive messages: ' + chalk.cyan('node src/daemon.js') + '\n');
    } else {
      try {
        await setupTelegram(path.join(ROOT, '.env'), {
          question: ttyQuestion,
          questionMasked: ttyQuestionMasked
        });
        console.log('  Run the gateway daemon to receive Telegram messages: ' + chalk.cyan('node src/daemon.js') + '\n');
      } catch (e) {
        console.log('  ⚠ Telegram setup: ' + (e.message || e) + '\n');
      }
    }
  } else if (hatch !== '4') {
    console.log('\n  🐣 Hatching into TUI...\n');
    await cmdTui();
  } else {
    console.log('\n  Run later:');
    console.log('    ' + chalk.cyan('node src/cli.js tui') + '       # Terminal chat');
    console.log('    ' + chalk.cyan('node src/cli.js dashboard') + '   # Web dashboard');
    console.log('    ' + chalk.cyan('node src/cli.js telegram-setup') + '   # Connect Telegram');
    if (process.env.TELEGRAM_BOT_TOKEN) {
      console.log('    ' + chalk.dim('Telegram runs with the gateway daemon (node src/daemon.js).'));
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
  const allSkills = listAllSkillsWithAuditStatus(ROOT);
  const eligible = listEligibleSkills(ROOT);
  console.log(chalk.cyan('\nAether-Claw Status'));
  console.log('─'.repeat(50));
  console.log('Version: ', config.version);
  console.log('Brain:   ', path.join(ROOT, 'brain'));
  console.log('Indexed: ', fileCount, 'files');
  console.log('Skills:  ', allSkills.length, 'found (' + eligible.length + ' passed audit)');
  console.log('Safety:  ', config.safety_gate?.enabled ? 'ON' : 'OFF');
  const reasoning = config.model_routing?.tier_1_reasoning?.model;
  const action = config.model_routing?.tier_2_action?.model;
  if (reasoning) console.log('Reasoning:', reasoning);
  if (action) console.log('Action:   ', action);
  console.log('');
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

  printBanner();

  if (isFirstRun(ROOT)) {
    console.log(chalk.cyan('You:\n') + SCRIPTED_USER_WAKE_UP + '\n');
    console.log(chalk.cyan('Aether-Claw:\n') + getBootstrapFirstMessage() + '\n');
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
      const skills = listAllSkillsWithAuditStatus(ROOT);
      if (skills.length === 0) console.log('\n  No skills in skills/ (add SKILL.md subdirs or use clawhub install)\n');
      else {
        console.log('\n  Skills:');
        skills.forEach((s) => console.log('    ' + (s.audit === 'passed' ? '✓' : '○') + ' ' + s.name + (s.audit === 'failed' ? ' (audit failed)' : '')));
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
    systemPrompt = systemPrompt + getBootstrapContext(ROOT);
    systemPrompt = buildSystemPromptWithSkills(systemPrompt, ROOT);

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
  const pairedChatId = process.env.TELEGRAM_CHAT_ID;
  if (!token) {
    console.log('Error: TELEGRAM_BOT_TOKEN not set. Run onboard to set up Telegram.');
    process.exit(1);
  }
  const config = loadConfig(path.join(ROOT, 'swarm_config.json'));
  const model = config.model_routing?.tier_1_reasoning?.model || 'anthropic/claude-3.7-sonnet';
  const baseSystemPrompt = 'You are Aether-Claw, a secure AI assistant. Be helpful and concise. Reply only in natural language and markdown. Do not include raw tool-call or function-call syntax in your message.';
  const telegramChatsReceivedFirstReply = new Set();
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
          const chatId = String(msg.chat.id);
          const text = (msg.text || '').trim();
          if (pairedChatId && chatId !== pairedChatId) continue;
          const fromName = (msg.from && msg.from.first_name) || 'User';
          console.log('[' + chatId + '] ' + fromName + ': ' + text);
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
                let systemPrompt = baseSystemPrompt;
                if (firstRun) systemPrompt += getBootstrapContext(ROOT);
                systemPrompt = buildSystemPromptWithSkills(systemPrompt, ROOT);
                const reply = await callLLM(
                  { prompt: text, systemPrompt, model, max_tokens: 4096 },
                  config
                );
                out = (reply || '').slice(0, 4000);
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
      if (e.code !== 'ECONNABORTED') console.error(e.message || e);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/**
 * Plan-then-build (Cursor-style) coding: planning agent then build agent.
 * Usage: code [--plan-only] [--no-plan] [task]
 * Task from argv, or TTY prompt, or stdin.
 */
async function cmdCode() {
  const argv = process.argv.slice(2);
  const planOnly = argv.includes('--plan-only');
  const noPlan = argv.includes('--no-plan');
  const rest = argv.filter((a) => a !== '--plan-only' && a !== '--no-plan');
  let task = rest.length ? rest.join(' ').trim() : '';

  if (!task) {
    if (process.stdin.isTTY) {
      task = (await ttyQuestion(chalk.cyan('Task (describe what to build or change): '))).trim();
    } else {
      task = await readStdin();
    }
  }
  if (!task) {
    console.log(chalk.red('Error: No task provided. Usage: node src/cli.js code [task] or pipe task via stdin.'));
    process.exit(1);
  }

  const config = loadConfig(path.join(ROOT, 'swarm_config.json'));

  let plan = '';
  if (!noPlan) {
    console.log(chalk.cyan('\nPhase 1: Planning\n') + '─'.repeat(40));
    try {
      plan = await callLLM(
        { prompt: task, systemPrompt: PLANNING_SYSTEM, tier: 'reasoning', max_tokens: 2048 },
        config
      );
      plan = (plan || '').trim();
      console.log(plan + '\n');
    } catch (e) {
      console.error(chalk.red('Planning failed: ') + (e.message || e));
      process.exit(1);
    }
    if (planOnly) {
      console.log(chalk.dim('(Plan only; use without --plan-only to run build.)\n'));
      return;
    }
  }

  console.log(chalk.cyan('Phase 2: Build\n') + '─'.repeat(40));
  const buildUserMessage = plan
    ? `Task: ${task}\n\nPlan to execute:\n${plan}`
    : task;
  try {
    const result = await runAgentLoop(ROOT, buildUserMessage, CODE_BUILD_SYSTEM, config, {
      tier: 'action',
      max_tokens: 4096
    });
    if (result.toolCallsCount) {
      console.log(chalk.dim('(used ' + result.toolCallsCount + ' tool calls)\n'));
    }
    const reply = result.error ? result.error : result.reply;
    console.log(chalk.green('Result:\n') + (reply || '(no reply)') + '\n');
  } catch (e) {
    console.error(chalk.red('Build failed: ') + (e.message || e));
    process.exit(1);
  }
}

/**
 * Ralph: PRD-driven autonomous loop. Runs agent until all stories pass or max iterations.
 * progress.txt is initialized if missing; archive on branch change.
 */
async function cmdRalph() {
  const { runRalph } = require('./ralph');
  const argv = process.argv.slice(2);
  const args = argv.filter((a) => a !== 'ralph' && !a.startsWith('-'));
  const maxIterations = parseInt(args[0], 10) || undefined;

  console.log(chalk.cyan('\nRalph – PRD-driven autonomous loop\n') + '─'.repeat(50));

  try {
    const result = await runRalph(ROOT, {
      maxIterations,
      onIteration(i, max) {
        console.log(chalk.blue('\n--- Ralph iteration ' + i + ' of ' + max + ' ---\n'));
      },
      onIterationDone(i, reply, runResult) {
        if (runResult.toolCallsCount) {
          console.log(chalk.dim('  (used ' + runResult.toolCallsCount + ' tool calls)'));
        }
      },
      onArchive(archiveFolder) {
        console.log(chalk.dim('Archived previous run to ' + archiveFolder + '\n'));
      }
    });

    if (result.completed) {
      if (result.iterations === 0 && result.message) {
        console.log(chalk.green(result.message) + '\n');
      } else {
        console.log(chalk.green('\nRalph completed all tasks!') + ' (iterations: ' + result.iterations + ')\n');
      }
    } else {
      console.log(chalk.yellow('\nRalph reached max iterations without completing all tasks.'));
      if (result.error) console.log(chalk.red(result.error));
      console.log('Check progress.txt and prd.json for status.\n');
      process.exit(1);
    }
  } catch (e) {
    console.error(chalk.red('Ralph failed: ') + (e.message || e));
    process.exit(1);
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
  if (cmd === 'code') {
    await cmdCode();
    return;
  }
  if (cmd === 'ralph') {
    await cmdRalph();
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
  console.log('  node src/cli.js code [task]   - plan then build (Cursor-style coding)');
  console.log('  node src/cli.js ralph [N]     - PRD-driven autonomous loop (Ralph-style)');
  console.log('  node src/cli.js status        - status');
  console.log('  node src/cli.js index         - index brain files (optional: <file>)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
