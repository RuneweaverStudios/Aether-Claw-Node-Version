const axios = require('axios');

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

/** Remove inline tool-call / function-call markup from LLM reply so only natural language is shown. */
function stripToolCallLeakage(text) {
  if (typeof text !== 'string') return text;
  const lower = text.toLowerCase();
  const idx1 = lower.indexOf('<|toolcall');
  const idx2 = lower.indexOf('<|tool_call');
  const idx3 = lower.indexOf('<functioncall');
  const idx4 = lower.indexOf('<toolcall');
  let idx = -1;
  for (const i of [idx1, idx2, idx3, idx4].filter((i) => i >= 0)) idx = idx < 0 ? i : Math.min(idx, i);
  if (idx >= 0) return text.slice(0, idx).trim();
  return text.trim();
}

/** Map deprecated/invalid OpenRouter model IDs to current valid IDs. */
const MODEL_ID_ALIASES = {
  'google/gemini-2.5-flash-preview': 'google/gemini-2.5-flash',
  'google/gemini-2.5-pro-preview': 'google/gemini-2.5-pro',
  'anthropic/claude-3.7-haiku': 'anthropic/claude-3.5-haiku'
};

function resolveModelAndMaxTokens(tier, config, modelOverride, maxTokensOverride) {
  let model = modelOverride;
  let max_tokens = maxTokensOverride ?? 4096;
  const fallbacks = [];
  if (tier && config?.model_routing) {
    const tierKey = tier === 'action' ? 'tier_2_action' : 'tier_1_reasoning';
    const tierConfig = config.model_routing[tierKey];
    if (tierConfig) {
      model = tierConfig.model;
      if (tierConfig.max_tokens != null) max_tokens = tierConfig.max_tokens;
      const fb = tierConfig.fallback;
      if (fb) fallbacks.push(...(Array.isArray(fb) ? fb : [fb]));
    }
  }
  if (!model) model = 'anthropic/claude-3.5-sonnet';
  if (model && MODEL_ID_ALIASES[model]) model = MODEL_ID_ALIASES[model];
  return { model, max_tokens, fallbacks };
}

/**
 * Call OpenRouter LLM. On failure, tries fallback model(s) if configured (model_routing.tier_*.fallback).
 * @param {Object} opts - prompt, systemPrompt, model (optional), max_tokens (optional), tier (optional 'reasoning'|'action')
 * @param {Object} config - optional config with model_routing; if tier is set, model is taken from config by tier
 */
async function callLLM(opts, config = null) {
  const { prompt, systemPrompt, model: modelOverride, max_tokens: maxTokensOverride, tier } = opts;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const { model: primary, max_tokens, fallbacks } = resolveModelAndMaxTokens(tier, config, modelOverride, maxTokensOverride);
  const modelsToTry = [primary, ...fallbacks];

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://github.com/aether-claw'
  };

  let lastError;
  for (const model of modelsToTry) {
    if (!model) continue;
    try {
      const { data } = await axios.post(
        `${OPENROUTER_BASE}/chat/completions`,
        { model, messages, max_tokens },
        { headers, timeout: 120000 }
      );
      let content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error(data.error?.message || 'No response content');
      content = stripToolCallLeakage(content);
      return content;
    } catch (e) {
      lastError = e;
      const status = e.response?.status;
      const retryable = status === 429 || (status >= 500 && status < 600);
      if (!retryable || modelsToTry.indexOf(model) === modelsToTry.length - 1) break;
    }
  }
  throw lastError || new Error('No response');
}

module.exports = { callLLM, resolveModelAndMaxTokens, stripToolCallLeakage };
