#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const chalk = require('chalk');
const { loadConfig } = require('./config');
const { callLLM } = require('./api');
const { indexAll, getBrainDir, searchMemory } = require('./brain');

const ROOT = path.resolve(__dirname, '..');

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

async function cmdOnboard() {
  console.log('\n  ' + chalk.cyan('╔════════════════════════════════════════════════════╗'));
  console.log('  ║              🥚 AETHERCLAW ONBOARDING 🥚             ║');
  console.log('  ╚════════════════════════════════════════════════════╝\n');

  let key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.log('  [1/3] 🔑 API Key');
    console.log('  Get your key at: https://openrouter.ai/keys\n');
    key = await ttyQuestion('  Enter OpenRouter API key');
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
    console.log('  [1/3] 🔑 API Key: found in environment\n');
  }

  console.log('  [2/3] 🧠 Brain');
  const brainDir = getBrainDir(ROOT);
  if (!fs.existsSync(path.join(brainDir, 'soul.md'))) {
    fs.writeFileSync(path.join(brainDir, 'soul.md'), '# Soul\n\nAgent identity and goals.\n', 'utf8');
    fs.writeFileSync(path.join(brainDir, 'user.md'), '# User\n\n- **Name**: [Your name]\n', 'utf8');
    fs.writeFileSync(path.join(brainDir, 'memory.md'), '# Memory\n\nLong-term memory log.\n', 'utf8');
    console.log('  ✓ Created brain/soul.md, user.md, memory.md\n');
  }
  const indexResults = indexAll(ROOT);
  console.log('  ✓ Indexed ' + Object.keys(indexResults).length + ' brain files\n');

  console.log('  [3/3] ✅ Onboarding complete.');
  console.log('\n  Run: ' + chalk.cyan('npm run tui') + ' or ' + chalk.cyan('node src/cli.js tui') + '\n');
}

function cmdStatus() {
  const config = loadConfig(path.join(ROOT, 'swarm_config.json'));
  console.log(chalk.cyan('\nAether-Claw Status'));
  console.log('─'.repeat(50));
  console.log('Version:', config.version);
  console.log('Brain:  ', path.join(ROOT, 'brain'));
  console.log('Safety: ', config.safety_gate?.enabled ? 'ON' : 'OFF');
  console.log('');
}

async function cmdTui() {
  const config = loadConfig(path.join(ROOT, 'swarm_config.json'));
  const model = config.model_routing?.tier_1_reasoning?.model || 'anthropic/claude-3.7-sonnet';

  console.log(chalk.blue('\n╔════════════════════════════════════════════════════╗'));
  console.log('║                 A E T H E R   C L A W                  ║');
  console.log('╚════════════════════════════════════════════════════╝\n');
  console.log('Type /help for commands, /quit to exit.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (prompt) => new Promise((res) => rl.question(prompt, res));

  const systemPrompt = `You are Aether-Claw, a secure AI assistant. Be helpful and concise.`;

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
      console.log('\n  /status - show status');
      console.log('  /memory <query> - search memory');
      console.log('  /quit - exit\n');
      continue;
    }
    if (input === '/status') {
      cmdStatus();
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
      const reply = await callLLM({
        prompt: input,
        systemPrompt,
        model,
        max_tokens: 4096
      });
      console.log(chalk.green('\nAether-Claw:\n') + reply + '\n');
    } catch (e) {
      console.log(chalk.red('Error: ') + (e.message || e) + '\n');
    }
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
  if (cmd === 'tui') {
    await cmdTui();
    return;
  }

  console.log('Aether-Claw (Node)');
  console.log('  node src/cli.js onboard   - first-time setup');
  console.log('  node src/cli.js tui       - chat TUI');
  console.log('  node src/cli.js status   - status');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
