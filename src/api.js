const axios = require('axios');

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

async function callLLM({ prompt, systemPrompt, model = 'anthropic/claude-3.7-sonnet', max_tokens = 2048 }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

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
