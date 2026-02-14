/**
 * Aether-Claw agent loop (OpenClaw-style): run the model with tools and execute tool calls
 * until the model returns a final text reply. Used for coding/action tasks.
 */

const axios = require('axios');
const path = require('path');
const { loadConfig } = require('./config');
const { resolveModelAndMaxTokens, stripToolCallLeakage } = require('./api');
const { TOOL_DEFINITIONS, runTool } = require('./tools');

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const ROOT_DEFAULT = path.resolve(__dirname, '..');
const MAX_ITERATIONS = 15;

/**
 * Call OpenRouter chat/completions with tools; return full message (content + tool_calls).
 */
async function chatWithTools(messages, config, options = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const tier = options.tier || 'action';
  const { model: primary, max_tokens, fallbacks } = resolveModelAndMaxTokens(tier, config, options.model, options.max_tokens);
  const modelsToTry = [primary, ...fallbacks].filter(Boolean);

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://github.com/aether-claw'
  };

  let lastError;
  for (const model of modelsToTry) {
    try {
      const body = {
        model,
        messages,
        max_tokens: max_tokens ?? 4096,
        tools: TOOL_DEFINITIONS,
        tool_choice: 'auto'
      };
      const { data } = await axios.post(`${OPENROUTER_BASE}/chat/completions`, body, { headers, timeout: 120000 });
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error(data.error?.message || 'No message in response');
      if (typeof msg.content === 'string') msg.content = stripToolCallLeakage(msg.content);
      return msg;
    } catch (e) {
      lastError = e;
      const status = e.response?.status;
      const body = e.response?.data;
      const apiMsg = body?.error?.message || body?.message || body?.error;
      const detail = apiMsg ? (typeof apiMsg === 'string' ? apiMsg : JSON.stringify(apiMsg)) : e.message;
      if (status === 400) {
        throw new Error('API request rejected (400): ' + detail);
      }
      const retryable = status === 429 || (status >= 500 && status < 600);
      if (!retryable || modelsToTry.indexOf(model) === modelsToTry.length - 1) break;
    }
  }
  throw lastError || new Error('No response');
}

/**
 * Run the agent loop: user message + system prompt → LLM with tools → execute tool_calls → repeat.
 * @param {string} workspaceRoot - Project root (for tool execution)
 * @param {string} userMessage - User prompt
 * @param {string} systemPrompt - System prompt for the agent
 * @param {Object} config - Swarm config (for model routing)
 * @param {{ tier?: string, maxIterations?: number, conversationHistory?: Array<{role:string,content:string}> }} options
 * @returns {{ reply: string, toolCallsCount?: number, error?: string }}
 */
const MAX_HISTORY_MESSAGES = 20;

async function runAgentLoop(workspaceRoot, userMessage, systemPrompt, config, options = {}) {
  const root = workspaceRoot || ROOT_DEFAULT;
  const maxIter = options.maxIterations ?? MAX_ITERATIONS;

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  const history = options.conversationHistory;
  if (Array.isArray(history) && history.length > 0) {
    const capped = history.slice(-MAX_HISTORY_MESSAGES);
    for (const m of capped) {
      if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') {
        messages.push({ role: m.role, content: m.content });
      }
    }
  }
  messages.push({ role: 'user', content: userMessage });

  let iterations = 0;
  let totalToolCalls = 0;

  while (iterations < maxIter) {
    iterations++;
    const tier = options.tier || 'action';
    const msg = await chatWithTools(messages, config, { tier, max_tokens: options.max_tokens });

    const toolCalls = msg.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      const text = (msg.content && msg.content.trim()) || '';
      return { reply: text, toolCallsCount: totalToolCalls };
    }

    totalToolCalls += toolCalls.length;
    messages.push({
      role: 'assistant',
      content: (msg.content && typeof msg.content === 'string') ? msg.content : '',
      tool_calls: toolCalls
    });

    for (const tc of toolCalls) {
      const name = tc.function?.name;
      let args = {};
      try {
        if (typeof tc.function?.arguments === 'string') {
          args = JSON.parse(tc.function.arguments);
        }
      } catch (e) {
        args = {};
      }
      const result = await runTool(root, name, args, { config });
      const content = typeof result === 'string' ? result : JSON.stringify(result);
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content
      });
    }
  }

  return {
    reply: 'Stopped after maximum tool-call iterations. Consider summarizing what was done so far.',
    toolCallsCount: totalToolCalls,
    error: 'Max iterations reached'
  };
}

module.exports = { runAgentLoop, chatWithTools, MAX_ITERATIONS };
