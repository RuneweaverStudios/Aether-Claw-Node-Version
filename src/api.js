const axios = require('axios');

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

/**
 * Call OpenRouter LLM.
 * @param {Object} opts - prompt, systemPrompt, model (optional), max_tokens (optional), tier (optional 'reasoning'|'action')
 * @param {Object} config - optional config with model_routing; if tier is set, model is taken from config by tier
 */
async function callLLM(opts, config = null) {
  const { prompt, systemPrompt, model: modelOverride, max_tokens: maxTokensOverride, tier } = opts;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  let model = modelOverride;
  let max_tokens = maxTokensOverride ?? 4096;
  if (tier && config?.model_routing) {
    const tierKey = tier === 'action' ? 'tier_2_action' : 'tier_1_reasoning';
    const tierConfig = config.model_routing[tierKey];
    if (tierConfig) {
      model = tierConfig.model;
      if (tierConfig.max_tokens != null) max_tokens = tierConfig.max_tokens;
    }
  }
  if (!model) model = 'anthropic/claude-3.7-sonnet';

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const { data } = await axios.post(
    `${OPENROUTER_BASE}/chat/completions`,
    { model, messages, max_tokens },
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/aether-claw'
      },
      timeout: 120000
    }
  );

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(data.error?.message || 'No response content');
  return content;
}

module.exports = { callLLM };
