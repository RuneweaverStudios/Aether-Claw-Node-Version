#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const os = require('os');
const readline = require('readline');
const { execSync } = require('child_process');

// Global flags (OpenClaw-style): apply before chalk so colors are disabled when requested
if (process.argv.includes('--no-color')) {
  process.env.NO_COLOR = '1';
  process.env.FORCE_COLOR = '0';
}

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const chalk = require('chalk');
const { program } = require('commander');
const crypto = require('crypto');
const { loadConfig, writeConfig } = require('./config');
const { callLLM } = require('./api');
const { runAgentLoop } = require('./agent-loop');
const { indexAll, getBrainDir, searchMemory, readIndex, indexFile } = require('./brain');
const { createReplyDispatcher, resolveSessionKey } = require('./gateway');
const { isFirstRun, updateUserProfile, updateSoul, getBootstrapFirstMessage, getBootstrapContext, SCRIPTED_USER_WAKE_UP } = require('./personality');
const { setupTelegram, sendTelegramMessage, sendChatAction } = require('./telegram-setup');
const { listAllSkillsWithAuditStatus, listEligibleSkills } = require('./openclaw-skills');
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

const BOX_W = 76;
function wrapBox(text, width) {
  const w = width || BOX_W - 6;
  const lines = [];
  for (const line of String(text).split(/\n/)) {
    let s = line;
    while (s.length > w) { lines.push(s.slice(0, w)); s = s.slice(w); }
    if (s.length) lines.push(s);
  }
  return lines;
}
function aetherclawBox(title, bodyLines) {
  const t = '  ' + title + ' ' + '─'.repeat(Math.max(0, BOX_W - title.length - 6)) + '';
  console.log(t);
  for (const line of bodyLines) {
    const p = (line + '').padEnd(BOX_W - 6).slice(0, BOX_W - 6);
    console.log('  ' + p + '  ');
  }
  console.log('  ' + '─'.repeat(BOX_W - 2));
}
function aetherclawStep(title) {
  console.log('  ' + title + ' ' + '─'.repeat(Math.max(0, BOX_W - title.length - 4)));
}
function aetherclawStepValue(value) {
  console.log('  ' + (value ?? ''));
}

function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

const openclawWrap = wrapBox;
const openclawBox = aetherclawBox;
const openclawStep = aetherclawStep;
const openclawStepValue = aetherclawStepValue;

function parseOnboardOpts() {
  const argv = process.argv.slice(2);
  const acceptRisk = argv.includes('--accept-risk');
  let flow = null;
  const flowIdx = argv.indexOf('--flow');
  if (flowIdx >= 0 && argv[flowIdx + 1]) {
    const f = (argv[flowIdx + 1] || '').trim().toLowerCase();
    if (f === 'quickstart' || f === 'manual') flow = f;
  }
  return { acceptRisk, flow };
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

/** Read stdin to end (for piping: echo "task" | aetherclaw code). */
function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(chunks.join('').trim()));
  });
}

const PLANNING_SYSTEM = `You are a coding task planner. Given a user request, produce a clear, ordered plan (numbered steps) only. Include: which files to create or edit, which commands to run, and any checks or tests to add. Output the plan in markdown. Do not write implementation code or code blocks—only the plan.`;
const CODE_BUILD_SYSTEM = `You are an expert programmer with access to tools: exec, process, read_file, write_file, create_directory, memory_search. Use these tools to run commands, read and write files, create folders, and search memory. To create a folder use create_directory (path e.g. ~/Desktop/name). Do not use fileoperations or createfolder. Only use tools from your tool list; never output raw FunctionCall or tool syntax. Execute the following plan step by step using your tools. Do not only describe—make the edits and run commands as needed.`;

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

const ONBOARD_SECURITY_BODY = `Security warning — please read.

This bot can read files and run actions if tools are enabled.
A bad prompt can trick it into doing unsafe things.

If you're not comfortable with basic security and access control, don't run it.
Recommended: pairing/allowlists, sandbox + least-privilege tools, keep secrets out of reach.
Run regularly: aetherclaw doctor`;

function readConfigSnapshot(configPath) {
  let config = {};
  let valid = false;
  const exists = fs.existsSync(configPath);
  if (exists) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      valid = !!(config.model_routing && (config.model_routing.tier_1_reasoning?.model || config.model_routing.tier_2_action?.model));
    } catch (_) {}
  }
  return { config, exists, valid };
}

async function cmdOnboard() {
  console.log(chalk.cyan('\n▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄'));
  console.log(chalk.cyan('                  A E T H E R C L A W                  \n'));
  console.log('  Onboarding');
  console.log('');
  aetherclawStep('Security');
  aetherclawBox('Security', wrapBox(ONBOARD_SECURITY_BODY));
  console.log('');
  const onboardOpts = parseOnboardOpts();
  if (!onboardOpts.acceptRisk) {
    const cont = (await ttyQuestion('  I understand this is powerful and inherently risky. Continue? [y/N]', 'n')).trim().toLowerCase();
    if (cont !== 'y' && cont !== 'yes') {
      console.log('  Exiting. Run with --accept-risk to skip this prompt.\n');
      process.exit(0);
    }
  }
  aetherclawStepValue('Accepted');
  console.log('');

  const configPath = path.join(ROOT, 'swarm_config.json');
  const snapshot = readConfigSnapshot(configPath);
  let config = snapshot.config;
  if (snapshot.exists && !snapshot.valid) {
    aetherclawStep('Invalid config');
    aetherclawBox('Invalid config', ['swarm_config.json exists but is invalid (e.g. missing model_routing).', 'Run: aetherclaw doctor', 'Or continue to use defaults.']);
    console.log('');
    const action = (await ttyQuestion('  [1] Exit and run doctor  [2] Continue with defaults (default: 2)', '2')).trim();
    if (action === '1') {
      process.exit(0);
    }
    config = loadConfig(configPath);
  }

  let flow = onboardOpts.flow;
  if (!flow) {
    aetherclawStep('Onboarding mode');
    const flowChoice = (await ttyQuestion('  [1] QuickStart (minimal prompts)  [2] Manual (default: 1)', '1')).trim();
    flow = flowChoice === '2' ? 'manual' : 'quickstart';
  }
  aetherclawStepValue(flow === 'quickstart' ? 'QuickStart' : 'Manual');
  console.log('');

  if (snapshot.exists && snapshot.valid) {
    aetherclawStep('Existing config');
    const wsDir = path.join(ROOT, config.brain?.directory || 'brain');
    const reasoning = config.model_routing?.tier_1_reasoning?.model || '—';
    aetherclawBox('Existing config', [
      'workspace: ' + wsDir,
      'model: ' + reasoning,
      'gateway.port: ' + (config.gateway?.port || process.env.PORT || '8501')
    ]);
    console.log('');
    const handling = (await ttyQuestion('  [1] Use existing  [2] Update values  [3] Reset (default: 2)', '2')).trim();
    if (handling === '3') {
      const resetScope = (await ttyQuestion('  Reset: [1] Config only  [2] Config + creds  [3] Full (config + creds + workspace backup)', '1')).trim();
      const backupDir = os.tmpdir();
      const envPath = path.join(ROOT, '.env');
      if (resetScope === '2' || resetScope === '3') {
        if (fs.existsSync(envPath)) {
          fs.copyFileSync(envPath, path.join(backupDir, 'aetherclaw-onboard.env'));
        }
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
        envContent = envContent.replace(/OPENROUTER_API_KEY=.*/m, '');
        fs.writeFileSync(envPath, envContent, 'utf8');
      }
      if (resetScope === '3') {
        const brainPath = path.join(ROOT, 'brain');
        if (fs.existsSync(brainPath)) {
          fs.cpSync(brainPath, path.join(backupDir, 'aetherclaw-onboard.brain'), { recursive: true });
        }
        config = {};
      }
      if (resetScope === '1' || resetScope === '2') {
        config = loadConfig(configPath);
        config.model_routing = config.model_routing || {};
        config.gateway = undefined;
      }
      writeConfig(configPath, config);
    }
    aetherclawStepValue(handling === '1' ? 'Use existing' : handling === '3' ? 'Reset' : 'Update values');
    console.log('');
  }

  const workspaceDir = flow === 'manual'
    ? (await ttyQuestion('  Workspace directory', config.brain?.directory ? path.join(ROOT, config.brain.directory) : ROOT)).trim() || ROOT
    : path.join(ROOT, config.brain?.directory || 'brain');
  if (!config.brain) config.brain = {};
  config.brain.directory = path.relative(ROOT, workspaceDir) || 'brain';
  writeConfig(configPath, { brain: config.brain });
  aetherclawStep('Workspace');
  aetherclawStepValue(workspaceDir);
  console.log('');

  renderProgress(1, ONBOARD_STEPS_TOTAL, 'API Key');
  let key = process.env.OPENROUTER_API_KEY;
  if (!key) {
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
      console.log('  API key saved to .env\n');
    }
  } else {
    console.log('  [1/6] API Key: found in environment\n');
  }

  renderProgress(2, ONBOARD_STEPS_TOTAL, 'Model selection');
  console.log('  [2/6] Model selection');
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
    '6': ['google/gemini-2.5-pro', 'varies'],
    '7': ['openai/gpt-4.1', 'varies'],
    '8': ['anthropic/claude-3.5-haiku', '$0.80/$4/M'],
    '9': ['google/gemini-2.5-flash', 'varies'],
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
  console.log('  Reasoning: ' + reasoningModel + ' (' + modelLabel + ')\n');
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
  console.log('  Action: ' + actionModel + '\n');
  config = loadConfig(configPath);
  writeConfig(configPath, {
    model_routing: {
      ...config.model_routing,
      tier_1_reasoning: { ...(config.model_routing?.tier_1_reasoning || {}), model: reasoningModel },
      tier_2_action: { ...(config.model_routing?.tier_2_action || {}), model: actionModel }
    }
  });
  console.log('  Model config saved to swarm_config.json\n');
  aetherclawStep('Model configured');
  aetherclawBox('Model configured', ['Default model set to ' + reasoningModel]);
  console.log('');

  let gatewayPort = Number(config.gateway?.port || process.env.PORT || 8501);
  let gatewayBind = config.gateway?.bind || 'loopback';
  let gatewayAuthMode = config.gateway?.auth?.mode || 'token';
  let gatewayToken = config.gateway?.auth?.token || process.env.AETHERCLAW_GATEWAY_TOKEN || '';
  if (flow === 'manual') {
    gatewayPort = Number((await ttyQuestion('  Gateway port', String(gatewayPort))).trim() || gatewayPort) || 8501;
    const bindChoice = (await ttyQuestion('  Gateway bind: [1] Loopback  [2] LAN  [3] Custom (default: 1)', '1')).trim();
    gatewayBind = bindChoice === '2' ? 'lan' : bindChoice === '3' ? 'custom' : 'loopback';
    const authChoice = (await ttyQuestion('  Gateway auth: [1] Token  [2] Password (default: 1)', '1')).trim();
    gatewayAuthMode = authChoice === '2' ? 'password' : 'token';
    if (gatewayAuthMode === 'token') {
      const tok = (await ttyQuestion('  Gateway token (blank to generate)', gatewayToken || '')).trim();
      gatewayToken = tok || randomToken();
    }
  } else {
    if (!gatewayToken) gatewayToken = randomToken();
  }
  let gatewayAuth;
  if (gatewayAuthMode === 'password') {
    const pwd = (await ttyQuestionMasked('  Gateway password: ')).trim();
    gatewayAuth = { mode: 'password', password: pwd };
  } else {
    gatewayAuth = { mode: 'token', token: gatewayToken };
  }
  writeConfig(configPath, {
    gateway: {
      port: gatewayPort,
      bind: gatewayBind,
      auth: gatewayAuth,
      tailscale: config.gateway?.tailscale || { mode: 'off' }
    }
  });
  aetherclawStep('Gateway');
  aetherclawStepValue('port ' + gatewayPort + ', bind ' + gatewayBind + ', auth ' + gatewayAuthMode);
  console.log('');

  renderProgress(3, ONBOARD_STEPS_TOTAL, 'Brain');
  openclawStep('Workspace OK / Brain');
  console.log('│');
  const brainDir = getBrainDir(ROOT);
  if (!fs.existsSync(path.join(brainDir, 'soul.md'))) {
    fs.writeFileSync(path.join(brainDir, 'soul.md'), '# Soul\n\nAgent identity and goals.\n', 'utf8');
    fs.writeFileSync(path.join(brainDir, 'user.md'), '# User\n\n- **Name**: [Your name]\n', 'utf8');
    fs.writeFileSync(path.join(brainDir, 'memory.md'), '# Memory\n\nLong-term memory log.\n', 'utf8');
    console.log('  ✓ Created brain/soul.md, user.md, memory.md\n');
    seedBootstrapIfNeeded(ROOT);
  }
  const indexResults = indexAll(ROOT);
  console.log('  ✓ Indexed ' + Object.keys(indexResults).length + ' brain files\n');
  console.log('│');
  openclawStep('Channel status');
  const tgConfigured = !!process.env.TELEGRAM_BOT_TOKEN;
  openclawBox('Channel status', [
    'Telegram: ' + (tgConfigured ? 'configured' : 'not configured'),
    'WhatsApp: not configured',
    'Discord: not configured',
    'Slack: not configured',
    'Others: install plugin to enable'
  ]);
  console.log('│');
  openclawStep('Configure chat channels now?');
  const doChannels = (await ttyQuestion('  Yes / No (default: Yes)', 'Yes')).trim().toLowerCase();
  const configureChannels = doChannels === 'yes' || doChannels === 'y' || doChannels === '';
  openclawStepValue(configureChannels ? 'Yes' : 'No');
  console.log('│');
  if (configureChannels) {
    openclawStep('How channels work');
    openclawBox('How channels work', openclawWrap(
      'DM security: default is pairing; unknown DMs get a pairing code. Telegram: register a bot with @BotFather.'
    ));
    console.log('│');
    openclawStep('Select a channel');
    const channelChoice = (await ttyQuestion('  [1] Telegram (Bot API)  [2] Finished (default: 1)', '1')).trim();
    const wantTelegram = channelChoice === '1' || channelChoice === '';
    openclawStepValue(wantTelegram ? 'Telegram (Bot API)' : 'Finished');
    console.log('│');
    if (wantTelegram) {
      openclawStep('Telegram already configured. What do you want to do?');
      const telegramAction = tgConfigured ? (await ttyQuestion('  [1] Modify settings  [2] Skip (default: 1)', '1')).trim() : '1';
      openclawStepValue(telegramAction === '2' ? 'Skip' : 'Modify settings');
      console.log('│');
      if (telegramAction !== '2') {
        renderProgress(4, ONBOARD_STEPS_TOTAL, 'Telegram');
        openclawStep('Telegram token already configured. Keep it?');
        const keepToken = tgConfigured ? (await ttyQuestion('  No / Yes (default: No)', 'No')).trim().toLowerCase() : 'no';
        openclawStepValue(keepToken === 'yes' || keepToken === 'y' ? 'Yes' : 'No');
        console.log('│');
        try {
          await setupTelegram(path.join(ROOT, '.env'), {
            question: ttyQuestion,
            questionMasked: ttyQuestionMasked
          });
        } catch (e) {
          console.log('  ⚠ Telegram setup skipped: ' + (e.message || e) + '\n');
        }
      }
      openclawStep('Select a channel');
      openclawStepValue('Finished');
      console.log('│');
    }
    openclawStep('Configure DM access policies now? (default: pairing)');
    const doDm = (await ttyQuestion('  Yes / No (default: Yes)', 'Yes')).trim().toLowerCase();
    openclawStepValue(doDm === 'yes' || doDm === 'y' || doDm === '' ? 'Yes' : 'No');
    console.log('│');
    openclawStep('Telegram DM policy');
    openclawStepValue('Pairing (recommended)');
    console.log('  Updated config / .env');
    console.log('│');
  }

  openclawStep('Skills status');
  const allSkills = listAllSkillsWithAuditStatus(ROOT);
  const eligibleSkills = listEligibleSkills(ROOT);
  const missingCount = allSkills.length - eligibleSkills.length;
  openclawBox('Skills status', [
    'Bundled by default: cursor-agent (open in Cursor / run Cursor CLI), composio-twitter (X/Twitter research via Composio)',
    'Eligible: ' + eligibleSkills.length,
    'Missing requirements: ' + Math.max(0, missingCount),
    'Blocked by allowlist: 0',
    'More: skills/README.md or clawhub install <slug>'
  ]);
  console.log('│');
  openclawStep('Configure skills now? (recommended)');
  const doSkills = (await ttyQuestion('  Yes / No (default: Yes)', 'Yes')).trim().toLowerCase();
  openclawStepValue(doSkills === 'yes' || doSkills === 'y' || doSkills === '' ? 'Yes' : 'No');
  console.log('│');
  if (doSkills === 'yes' || doSkills === 'y' || doSkills === '') {
    openclawStep('Preferred node manager for skill installs');
    openclawStepValue('npm');
    console.log('│');
    openclawStep('Install missing skill dependencies');
    openclawStepValue('Skip for now');
    console.log('│');
  }
  openclawStep('Hooks');
  openclawBox('Hooks', openclawWrap(
    'Hooks let you automate actions when agent commands are issued. Example: Save session context when you issue /new.'
  ));
  console.log('│');
  openclawStep('Enable hooks?');
  openclawStepValue('Skip for now');
  console.log('│');

  renderProgress(5, ONBOARD_STEPS_TOTAL, 'Gateway');
  openclawStep('Install Gateway service (recommended)');
  const doGateway = (await ttyQuestion('  Yes / No (default: Yes)', 'Yes')).trim().toLowerCase();
  openclawStepValue(doGateway === 'yes' || doGateway === 'y' || doGateway === '' ? 'Yes' : 'No');
  console.log('│');
  openclawStep('Gateway service runtime');
  openclawStepValue('Node (recommended)');
  console.log('│');
  if (process.platform === 'darwin' && (doGateway === 'yes' || doGateway === 'y' || doGateway === '')) {
    console.log('◒  Installing Gateway service…...');
    try {
      const { runGatewaySetup } = require('./gateway-install');
      await runGatewaySetup(ROOT, { ttyQuestion });
      console.log('◇  Gateway service installed.');
    } catch (e) {
      console.log('  ⚠ Gateway setup skipped: ' + (e.message || e) + '\n');
    }
  } else if (process.platform !== 'darwin') {
    console.log('  To run the gateway daemon: ' + chalk.cyan('aetherclaw daemon') + '\n');
  }
  console.log('│');

  renderProgress(6, ONBOARD_STEPS_TOTAL, 'Complete');
  const port = gatewayPort;
  openclawStep('Status');
  openclawBox('Status', [
    'Telegram: ' + (process.env.TELEGRAM_BOT_TOKEN ? 'ok' : 'not configured'),
    'Agents: main (default)',
    'Heartbeat interval: 30m (main)',
    'Web dashboard: http://127.0.0.1:' + port + '/'
  ]);
  console.log('│');
  openclawStep('Optional apps');
  openclawBox('Optional apps', [
    'Add nodes for extra features:',
    '- macOS app (system + notifications)',
    '- iOS app (camera/canvas)',
    '- Android app (camera/canvas)'
  ]);
  console.log('│');
  openclawStep('Control UI');
  openclawBox('Control UI', [
    'Web UI: http://127.0.0.1:' + port + '/',
    'Gateway: reachable',
    'Open the dashboard anytime: aetherclaw dashboard'
  ]);
  console.log('│');
  openclawStep('Token');
  openclawBox('Token', openclawWrap(
    'Gateway token: shared auth for the Gateway + Control UI. Stored in swarm_config.json (gateway.auth.token). Open the dashboard anytime: aetherclaw dashboard'
  ));
  console.log('│');
  console.log('  How do you want to hatch your bot?');
  console.log('  [1] TUI (recommended)  [2] Web UI  [3] Later\n');
  const hatchChoice = (await ttyQuestion('  [1] TUI  [2] Web UI  [3] Later (default: 1)', '1')).trim();
  const hatch = hatchChoice === '2' ? '2' : hatchChoice === '3' ? '4' : '1';
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
    const url = `http://localhost:${gatewayPort}`;
    console.log('\n  Launching Web dashboard...\n');
    const child = spawn(process.execPath, [path.join(ROOT, 'src', 'dashboard.js')], {
      cwd: ROOT,
      stdio: [null, 'inherit', 'inherit'],
      env: { ...process.env, PORT: String(gatewayPort) }
    });
    child.on('error', (err) => {
      console.log('  Could not start dashboard:', err.message);
      console.log('  Run: aetherclaw dashboard\n');
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
    console.log('\n  Hatch in Telegram...\n');
    require('dotenv').config({ path: path.join(ROOT, '.env') });
    if (process.env.TELEGRAM_BOT_TOKEN) {
      console.log('  Telegram is already connected. Run the gateway to receive messages: ' + chalk.cyan('aetherclaw daemon') + '\n');
    } else {
      try {
        await setupTelegram(path.join(ROOT, '.env'), {
          question: ttyQuestion,
          questionMasked: ttyQuestionMasked
        });
        console.log('  Run the gateway daemon to receive Telegram messages: ' + chalk.cyan('aetherclaw daemon') + '\n');
      } catch (e) {
        console.log('  ⚠ Telegram setup: ' + (e.message || e) + '\n');
      }
    }
  } else if (hatch !== '4') {
    console.log('\n  Hatching into TUI...\n');
    await cmdTui();
  } else {
    console.log('\n  Run later:');
    console.log('    ' + chalk.cyan('aetherclaw tui') + '       # Terminal chat');
    console.log('    ' + chalk.cyan('aetherclaw dashboard') + '   # Web dashboard');
    console.log('    ' + chalk.cyan('aetherclaw telegram-setup') + '   # Connect Telegram');
    if (process.env.TELEGRAM_BOT_TOKEN) {
      console.log('    ' + chalk.dim('Telegram runs with the gateway daemon (aetherclaw daemon).'));
    }
    console.log('');
  }
}

function dashboardCmd() {
  return 'aetherclaw dashboard';
}

function cmdStatus(opts = {}) {
  const config = loadConfig(path.join(ROOT, 'swarm_config.json'));
  const index = readIndex(ROOT);
  const fileCount = Object.keys(index.files || {}).length;
  const allSkills = listAllSkillsWithAuditStatus(ROOT);
  const eligible = listEligibleSkills(ROOT);
  if (opts.json) {
    console.log(JSON.stringify({
      version: config.version,
      brain: path.join(ROOT, 'brain'),
      indexedFiles: fileCount,
      skillsTotal: allSkills.length,
      skillsEligible: eligible.length,
      safetyGate: config.safety_gate?.enabled ?? true,
      reasoningModel: config.model_routing?.tier_1_reasoning?.model,
      actionModel: config.model_routing?.tier_2_action?.model
    }, null, 0));
    return;
  }
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
  const actionModel = config.model_routing?.tier_2_action?.model || 'anthropic/claude-3.5-haiku';

  printBanner();

  if (isFirstRun(ROOT)) {
    console.log(chalk.cyan('You:\n') + SCRIPTED_USER_WAKE_UP + '\n');
    console.log(chalk.cyan('Aether-Claw:\n') + getBootstrapFirstMessage() + '\n');
  }
  console.log('Type /help for commands, /quit to exit.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (prompt) => new Promise((res) => rl.question(prompt, res));

  const replyDispatcher = createReplyDispatcher({ workspaceRoot: ROOT });
  const tuiSessionKey = resolveSessionKey({ channel: 'tui' });

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
      const { clearSession } = require('./tools');
      clearSession(tuiSessionKey);
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

    console.log(chalk.dim('Thinking...'));
    try {
      const result = await replyDispatcher(tuiSessionKey, input, { channel: 'tui' });
      const reply = result.error && !result.reply ? result.error : (result.reply || '');
      if (result.toolCallsCount) console.log(chalk.dim('  (used ' + result.toolCallsCount + ' tool calls)\n'));
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
  const baseSystemPrompt = 'You are Aether-Claw, a secure AI assistant. Be helpful and concise. If the user asks to connect GitHub or whether Aether-Claw is connected to GitHub, use the github_connect tool and share the result or instructions. Reply only in natural language and markdown. Do not include raw tool-call or function-call syntax in your message.';
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
async function cmdCode(taskArg, opts = {}) {
  const planOnly = opts.planOnly || process.argv.includes('--plan-only');
  const noPlan = opts.noPlan === true || process.argv.includes('--no-plan');
  const argv = process.argv.slice(2);
  const rest = argv.filter((a) => a !== '--plan-only' && a !== '--no-plan' && a !== 'code');
  let task = typeof taskArg === 'string' && taskArg.trim() ? taskArg.trim() : (rest.length ? rest.join(' ').trim() : '');

  if (!task) {
    if (process.stdin.isTTY) {
      task = (await ttyQuestion(chalk.cyan('Task (describe what to build or change): '))).trim();
    } else {
      task = await readStdin();
    }
  }
  if (!task) {
    console.log(chalk.red('Error: No task provided. Usage: aetherclaw code [task] or pipe task via stdin.'));
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
async function cmdRalph(maxIterationsArg) {
  const { runRalph } = require('./ralph');
  const argv = process.argv.slice(2);
  const args = argv.filter((a) => a !== 'ralph' && !a.startsWith('-'));
  const maxIterations = typeof maxIterationsArg !== 'undefined' && maxIterationsArg !== null
    ? parseInt(String(maxIterationsArg), 10) || undefined
    : (parseInt(args[0], 10) || undefined);

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

/**
 * Update install to latest from origin; preserve .env, swarm_config.json, and brain/ (soul, user, personality, etc.).
 * Usage: aetherclaw latest
 */
function cmdLatest() {
  const gitDir = path.join(ROOT, '.git');
  if (!fs.existsSync(gitDir) || !fs.statSync(gitDir).isDirectory()) {
    console.error(chalk.red('Not a git repo. Run this from a clone (e.g. install via install.sh).'));
    process.exit(1);
  }
  const envPath = path.join(ROOT, '.env');
  const configPath = path.join(ROOT, 'swarm_config.json');
  const brainPath = path.join(ROOT, 'brain');
  const backupDir = os.tmpdir();
  const envBackup = path.join(backupDir, 'aetherclaw-update.env');
  const configBackup = path.join(backupDir, 'aetherclaw-update.swarm_config.json');
  const brainBackup = path.join(backupDir, 'aetherclaw-update.brain');
  const restoreBrain = () => {
    if (!fs.existsSync(brainBackup)) return;
    if (fs.existsSync(brainPath)) fs.rmSync(brainPath, { recursive: true });
    fs.mkdirSync(brainPath, { recursive: true });
    fs.cpSync(brainBackup, brainPath, { recursive: true });
    fs.rmSync(brainBackup, { recursive: true });
    console.log(chalk.green('  Restored brain/ (soul.md, user.md, identity.md, memory, etc.)'));
  };
  try {
    if (fs.existsSync(envPath)) {
      fs.copyFileSync(envPath, envBackup);
      console.log(chalk.dim('  Backed up .env'));
    }
    if (fs.existsSync(configPath)) {
      fs.copyFileSync(configPath, configBackup);
      console.log(chalk.dim('  Backed up swarm_config.json'));
    }
    if (fs.existsSync(brainPath)) {
      fs.cpSync(brainPath, brainBackup, { recursive: true });
      console.log(chalk.dim('  Backed up brain/ (soul, user, personality, memory, skills, etc.)'));
    }
    execSync('git fetch origin', { cwd: ROOT, stdio: 'inherit' });
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
    execSync(`git reset --hard origin/${branch}`, { cwd: ROOT, stdio: 'inherit' });
    if (fs.existsSync(envBackup)) {
      fs.copyFileSync(envBackup, envPath);
      fs.unlinkSync(envBackup);
      console.log(chalk.green('  Restored .env (API key and Telegram unchanged)'));
    }
    if (fs.existsSync(configBackup)) {
      fs.copyFileSync(configBackup, configPath);
      fs.unlinkSync(configBackup);
      console.log(chalk.green('  Restored swarm_config.json'));
    }
    restoreBrain();
    execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
    console.log(chalk.green('\n✓ Aether-Claw updated to latest. Your .env, config, and brain (soul, user, personality) were left unchanged.\n'));
  } catch (e) {
    if (fs.existsSync(envBackup)) try { fs.copyFileSync(envBackup, envPath); fs.unlinkSync(envBackup); } catch (_) {}
    if (fs.existsSync(configBackup)) try { fs.copyFileSync(configBackup, configPath); fs.unlinkSync(configBackup); } catch (_) {}
    try { restoreBrain(); } catch (_) {}
    console.error(chalk.red('Update failed: ') + (e.message || e));
    process.exit(1);
  }
}

// --- Commander CLI (OpenClaw-style: global flags, subcommands, per-command help) ---
const pkg = require('../package.json');
program
  .name('aetherclaw')
  .description('Aether-Claw – secure swarm-based AI assistant (Node). Use aetherclaw <command> --help for per-command help.')
  .version(pkg.version, '-V, --version', 'print version and exit')
  .option('--no-color', 'disable ANSI colors')
  .option('--json', 'machine-readable output (for status, doctor)');

program
  .command('help')
  .description('show all available commands')
  .action(() => program.help());

program
  .command('onboard')
  .alias('install')
  .description('first-time setup (API key, brain, optional Telegram)')
  .action(() => cmdOnboard());

program
  .command('telegram-setup')
  .description('connect or reconnect Telegram bot only')
  .option('-y, --yes', 'skip prompts where possible')
  .action(() => cmdTelegramSetup());

program
  .command('tui')
  .description('chat TUI (gateway routing)')
  .action(() => cmdTui());

program
  .command('telegram')
  .description('start Telegram bot only (foreground)')
  .action(() => cmdTelegram());

program
  .command('daemon')
  .description('gateway daemon (heartbeat + Telegram)')
  .action(() => require('./daemon'));

program
  .command('dashboard')
  .description('web dashboard (Chat, Status, Config)')
  .action(() => require('./dashboard'));

program
  .command('doctor')
  .description('health check and suggestions')
  .option('--json', 'output checks as JSON')
  .action(() => {
    const { cmdDoctor } = require('./doctor');
    cmdDoctor(program.opts());
  });

program
  .command('latest')
  .description('update to latest from repo (keeps .env and config)')
  .action(() => cmdLatest());

program
  .command('code [task]')
  .description('plan then build (Cursor-style coding); task from arg or stdin')
  .option('--plan-only', 'only print the plan')
  .option('--no-plan', 'skip plan, run build only')
  .action((task, cmd) => cmdCode(task || '', cmd.opts()));

program
  .command('ralph [maxIterations]')
  .description('PRD-driven autonomous loop (Ralph-style); maxIterations is optional')
  .action((maxIterations) => cmdRalph(maxIterations));

program
  .command('status')
  .description('show status (config, index, skills)')
  .option('--json', 'output as JSON')
  .action(() => cmdStatus(program.opts()));

program
  .command('index [file]')
  .description('index brain files for memory search (optional: single file)')
  .action((file) => cmdIndex(file));

const configCmd = program.command('config').description('get or set config values (dot path)');
configCmd
  .command('get <key>')
  .description('get a config value by dot path (e.g. model_routing.tier_1_reasoning.model)')
  .action((key) => {
    const config = loadConfig(path.join(ROOT, 'swarm_config.json'));
    const val = key.split('.').reduce((o, k) => (o != null ? o[k] : undefined), config);
    if (val === undefined) {
      console.error('Key not found:', key);
      process.exit(1);
    }
    console.log(typeof val === 'object' ? JSON.stringify(val) : val);
  });
configCmd
  .command('set <key> <value>')
  .description('set a config value (value is JSON or string)')
  .action((key, value) => {
    const configPath = path.join(ROOT, 'swarm_config.json');
    let config;
    try {
      config = loadConfig(configPath);
    } catch (e) {
      config = {};
    }
    const keys = key.split('.');
    let parsed = value;
    try {
      parsed = JSON.parse(value);
    } catch (_) {}
    let target = config;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in target) || typeof target[k] !== 'object' || Array.isArray(target[k])) target[k] = {};
      target = target[k];
    }
    target[keys[keys.length - 1]] = parsed;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    console.log('Set', key);
  });

program.exitOverride(); // so we can set exit 0 when showing help (no args)
program.parseAsync(process.argv).then(() => {
  if (!process.argv.slice(2).length) process.exitCode = 0;
}).catch((e) => {
  if (e.code === 'commander.help' || e.code === 'commander.helpDisplayed' || e.code === 'commander.unknownCommand') {
    process.exitCode = 0;
    return;
  }
  console.error(e);
  process.exit(1);
});
