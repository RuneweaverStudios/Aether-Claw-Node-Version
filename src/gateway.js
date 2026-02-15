/**
 * Gateway: OpenClaw-style action routing, agent loops, tools, and skills.
 *
 * One reply pipeline (createReplyDispatcher): no separate intent router.
 * Flow: Channel → session key → reply dispatcher → runAgentLoop (LLM + tools in a loop).
 * The model sees the full tool set and the skills list; it chooses which tools to call
 * (and optionally which SKILL.md to read via read_file).
 */

const path = require('path');
const { loadConfig } = require('./config');
const { runAgentLoop } = require('./agent-loop');
const { getSessionHistory, pushSessionMessage, SESSION_MAIN } = require('./tools');
const { buildWorkspaceSkillSnapshot } = require('./openclaw-skills');
const { isFirstRun, getBootstrapContext } = require('./personality');

const ROOT_DEFAULT = path.resolve(__dirname, '..');

/** Base system prompt: one agent with full tools; no intent-based branching. */
const BASE_SYSTEM_PROMPT = `You are Aether-Claw, a secure AI assistant with access to tools (read_file, write_file, edit, exec, process, create_directory, memory_search, memory_get, web_search, web_fetch, github_connect, and others). Use tools when needed to fulfill the user's request. If the user asks to connect GitHub or whether Aether-Claw is connected to GitHub, use the github_connect tool (action: check or login) and share the result or instructions. To create a folder (e.g. on Desktop) use create_directory with path like ~/Desktop/foldername, or exec with mkdir -p. Only use tools from your tool list; never output raw function-call or tool syntax in your message. Reply in natural language and markdown.

## Model and responses
You run on a model chosen for this session (cheap/fast by default for most tasks; a more capable model may be used for complex or deep work). The system will prefix your reply with the model name in parentheses (e.g. (Claude 3.5 Haiku)); you do not need to repeat it. When a task clearly requires deep reasoning, debugging, or multi-step planning, say briefly that you are using or would recommend a more expensive/capable model—e.g. "Using a more capable model for this." or "For deeper troubleshooting, a stronger model would help."

## Brain and identity
Your identity and configuration live in the brain/ directory. When the user asks to see your soul, identity, config, or brain, use read_file on the relevant file and share or summarize it.
- brain/soul.md — your goals, how to behave, what matters ("show my soul", "soul.md", "your soul")
- brain/identity.md — your name, creature, vibe, emoji
- brain/user.md — the user's name and preferences
- brain/memory.md — long-term memory log
Other .md files in brain/ (e.g. BOOTSTRAP.md, audit_log.md) may exist; use read_file when relevant.`;

/**
 * Build the full system prompt for a run: base + bootstrap context + skills section.
 * @param {string} workspaceRoot
 * @param {{ skillsSnapshot?: { prompt: string } }} opts - Optional pre-built skills snapshot
 */
function buildSystemPromptForRun(workspaceRoot, opts = {}) {
  const root = workspaceRoot || ROOT_DEFAULT;
  let system = BASE_SYSTEM_PROMPT;
  if (isFirstRun(root)) system += getBootstrapContext(root);
  const snapshot = opts.skillsSnapshot || buildWorkspaceSkillSnapshot(root);
  if (snapshot.prompt) system += '\n\n## Skills\n\n' + snapshot.prompt;
  return system;
}

/**
 * Create the OpenClaw-style reply dispatcher: one pipeline that handles the message
 * and runs the agent loop with full tools + skills.
 *
 * @param {Object} config - { workspaceRoot?: string }
 * @returns {Promise<{ reply: string, error?: string }>} async (sessionKey, body, context) => result
 */
function createReplyDispatcher(config = {}) {
  const workspaceRoot = config.workspaceRoot || ROOT_DEFAULT;

  return async function reply(sessionKey, body, context = {}) {
    const key = sessionKey || SESSION_MAIN;
    const text = (body && String(body).trim()) || '';
    if (!text) return { reply: '', error: 'Empty message' };

    // Inline commands: handle without LLM (optional; keeps /status, /skills fast)
    if (text === '/status') {
      try {
        const { getSystemStatus } = require('./dashboard');
        const status = getSystemStatus();
        const reply = status.error
          ? 'Status: ' + status.error
          : `Version ${status.version || '?'} | Indexed: ${status.indexed_files || 0} | Skills: ${status.valid_skills ?? 0}/${status.skills ?? 0} | Models: reasoning=${status.reasoning_model || '?'}, action=${status.action_model || '?'}`;
        return { reply };
      } catch (e) {
        return { reply: 'Status error: ' + (e.message || e) };
      }
    }
    if (text === '/skills') {
      try {
        const { listAllSkillsWithAuditStatus } = require('./openclaw-skills');
        const skills = listAllSkillsWithAuditStatus(workspaceRoot);
        if (skills.length === 0) return { reply: 'No skills in skills/ (add SKILL.md subdirs).' };
        const lines = skills.map(s => (s.audit === 'passed' ? '✓' : '○') + ' ' + s.name);
        return { reply: 'Skills:\n' + lines.join('\n') };
      } catch (e) {
        return { reply: 'Skills error: ' + (e.message || e) };
      }
    }

    const cfg = loadConfig(path.join(workspaceRoot, 'swarm_config.json'));
    const skillsSnapshot = buildWorkspaceSkillSnapshot(workspaceRoot);
    const systemPrompt = buildSystemPromptForRun(workspaceRoot, { skillsSnapshot });
    const conversationHistory = getSessionHistory(key, 20).map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    }));

    try {
      const result = await runAgentLoop(workspaceRoot, text, systemPrompt, cfg, {
        tier: 'action',
        max_tokens: 4096,
        conversationHistory
      });
      const replyText = result.error && !result.reply ? result.error : (result.reply || '');
      pushSessionMessage(key, 'user', text);
      pushSessionMessage(key, 'assistant', replyText);
      return { reply: replyText, error: result.error, toolCallsCount: result.toolCallsCount, modelUsed: result.modelUsed };
    } catch (e) {
      const errMsg = e.message || String(e);
      pushSessionMessage(key, 'user', text);
      pushSessionMessage(key, 'assistant', 'Error: ' + errMsg);
      return { reply: '', error: errMsg };
    }
  };
}

/**
 * Resolve session key from channel context (OpenClaw-style: agentId, channel, group).
 * Aether-Claw: main, tui, telegram:chatId, dashboard.
 */
function resolveSessionKey(context = {}) {
  if (context.sessionKey) return context.sessionKey;
  if (context.channel === 'telegram' && context.chatId) return 'telegram:' + context.chatId;
  if (context.channel === 'dashboard') return 'dashboard';
  if (context.channel === 'tui') return 'tui';
  return SESSION_MAIN;
}

module.exports = {
  createReplyDispatcher,
  resolveSessionKey,
  buildSystemPromptForRun,
  buildWorkspaceSkillSnapshot,
  BASE_SYSTEM_PROMPT,
  SESSION_MAIN
};
