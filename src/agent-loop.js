/**
 * Aether-Claw agent loop (OpenClaw-style): run the model with tools and execute tool calls
 * until the model returns a final text reply. Used for coding/action tasks.
 */

const axios = require('axios');
const path = require('path');
const { loadConfig } = require('./config');
const { resolveModelAndMaxTokens, stripToolCallLeakage, modelIdToDisplayName } = require('./api');
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
      const usage = data.usage ? { prompt_tokens: data.usage.prompt_tokens, completion_tokens: data.usage.completion_tokens, total_tokens: data.usage.total_tokens } : undefined;
      return { msg, modelUsed: model, usage };
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
 * Parse SSE stream from OpenRouter/OpenAI-style streaming; invoke onChunk for each content delta.
 * Returns { content, toolCalls, modelUsed } when stream ends (toolCalls set when finish_reason is tool_calls).
 */
async function chatWithToolsStream(messages, config, options = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const tier = options.tier || 'action';
  const { model: primary, max_tokens } = resolveModelAndMaxTokens(tier, config, options.model, options.max_tokens);

  const body = {
    model: primary,
    messages,
    max_tokens: max_tokens ?? 4096,
    tools: TOOL_DEFINITIONS,
    tool_choice: 'auto',
    stream: true
  };

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/aether-claw'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(res.status + ' ' + err);
  }

  const onChunk = options.onChunk || (() => {});
  let content = '';
  const toolCallsAcc = []; // { id, type, function: { name, arguments } } by index
  let finishReason = null;
  let usage = null;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          const obj = JSON.parse(data);
          if (obj.usage) usage = { prompt_tokens: obj.usage.prompt_tokens, completion_tokens: obj.usage.completion_tokens, total_tokens: obj.usage.total_tokens };
          const choice = obj.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta || {};
          if (delta.content) {
            content += delta.content;
            onChunk(delta.content);
          }
          if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const i = tc.index;
              if (!toolCallsAcc[i]) {
                toolCallsAcc[i] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } };
              }
              if (tc.id) toolCallsAcc[i].id = tc.id;
              if (tc.function?.name) toolCallsAcc[i].function.name += tc.function.name || '';
              if (tc.function?.arguments) toolCallsAcc[i].function.arguments += tc.function.arguments || '';
            }
          }
          if (choice.finish_reason) finishReason = choice.finish_reason;
        } catch (_) {}
      }
    }
  }

  content = stripToolCallLeakage(content);
  const toolCalls = finishReason === 'tool_calls' && toolCallsAcc.length > 0
    ? toolCallsAcc.filter(Boolean).map((tc) => ({ ...tc, function: { name: tc.function.name.trim(), arguments: tc.function.arguments } }))
    : null;

  return { content, toolCalls, modelUsed: primary, usage };
}

/**
 * Run the agent loop with streaming: call onChunk(text) for each content delta, onStep(step) for each tool call/result.
 * @param {Object} options - onChunk, onStep optional callbacks
 * @returns {{ reply: string, toolCallsCount?: number, error?: string, modelUsed?: string }}
 */
async function runAgentLoopStream(workspaceRoot, userMessage, systemPrompt, config, options = {}) {
  const root = workspaceRoot || ROOT_DEFAULT;
  const maxIter = options.maxIterations ?? MAX_ITERATIONS;
  const onChunk = options.onChunk || (() => {});
  const onStep = options.onStep || (() => {});

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
  let modelUsed = null;
  let fullContent = '';

  let lastUsage = null;
  while (iterations < maxIter) {
    iterations++;
    const { content, toolCalls, modelUsed: used, usage: turnUsage } = await chatWithToolsStream(messages, config, {
      tier: options.tier || 'action',
      max_tokens: options.max_tokens,
      onChunk
    });
    if (used) modelUsed = used;
    if (turnUsage) lastUsage = turnUsage;
    fullContent = content;

    if (!toolCalls || toolCalls.length === 0) {
      const displayName = modelIdToDisplayName(modelUsed);
      const prefix = displayName ? `(${displayName})\n\n` : '';
      return { reply: prefix + fullContent.trim(), toolCallsCount: totalToolCalls, modelUsed, usage: lastUsage };
    }

    totalToolCalls += toolCalls.length;
    messages.push({
      role: 'assistant',
      content: fullContent || '',
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
      onStep({ type: 'tool_call', name, args, ts: Date.now() });
      let result;
      try {
        result = await runTool(root, name, args, { config, readOnly: options.readOnly });
        onStep({ type: 'tool_result', name, result, ts: Date.now() });
      } catch (e) {
        result = { error: e.message || String(e) };
        onStep({ type: 'tool_result', name, error: e.message, ts: Date.now() });
      }
      const contentStr = typeof result === 'string' ? result : JSON.stringify(result);
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: contentStr
      });
    }
  }

  const displayName = modelIdToDisplayName(modelUsed);
  const prefix = displayName ? `(${displayName})\n\n` : '';
  return {
    reply: prefix + 'Stopped after maximum tool-call iterations. Consider summarizing what was done so far.',
    toolCallsCount: totalToolCalls,
    error: 'Max iterations reached',
    modelUsed,
    usage: lastUsage
  };
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
  let modelUsed = null;

  let lastUsage = null;
  while (iterations < maxIter) {
    iterations++;
    const tier = options.tier || 'action';
    const { msg, modelUsed: used, usage: turnUsage } = await chatWithTools(messages, config, { tier, max_tokens: options.max_tokens });
    if (used) modelUsed = used;
    if (turnUsage) lastUsage = turnUsage;

    const toolCalls = msg.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      const text = (msg.content && msg.content.trim()) || '';
      const displayName = modelIdToDisplayName(modelUsed);
      const prefix = displayName ? `(${displayName})\n\n` : '';
      return { reply: prefix + text, toolCallsCount: totalToolCalls, modelUsed, usage: lastUsage };
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
      const result = await runTool(root, name, args, { config, readOnly: options.readOnly });
      const content = typeof result === 'string' ? result : JSON.stringify(result);
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content
      });
    }
  }

  const displayName = modelIdToDisplayName(modelUsed);
  const prefix = displayName ? `(${displayName})\n\n` : '';
  return {
    reply: prefix + 'Stopped after maximum tool-call iterations. Consider summarizing what was done so far.',
    toolCallsCount: totalToolCalls,
    error: 'Max iterations reached',
    modelUsed,
    usage: lastUsage
  };
}

module.exports = { runAgentLoop, runAgentLoopStream, chatWithTools, chatWithToolsStream, MAX_ITERATIONS };
