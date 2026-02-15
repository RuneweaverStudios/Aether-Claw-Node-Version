/**
 * Complexity classifier: score user message 1-5 to choose reasoning vs action tier.
 * Uses a cheap model (e.g. Gemini Flash) so the main reply can use a more expensive model when needed.
 */

const { callLLM } = require('./api');

const CLASSIFIER_SYSTEM = 'You are a classifier. Reply with only a single integer 1-5. 1=trivial/simple (greeting, yes/no, single fact). 5=complex (deep reasoning, multi-step, debugging, planning, nuanced). No explanation.';

const MAX_MESSAGE_LENGTH = 2000;

/**
 * Classify complexity of the user message. Returns 1-5; on failure returns 1 (safe default = action tier).
 * @param {string} userMessage - Raw user message
 * @param {Object} config - Swarm config (model_routing.complexity_classifier, complexity_threshold)
 * @returns {Promise<number>} Score 1-5
 */
async function classifyComplexity(userMessage, config) {
  const mr = config?.model_routing || {};
  const cc = mr.complexity_classifier || {};
  if (cc.enabled === false) return 1;

  const model = cc.model || 'google/gemini-2.5-flash';
  const prompt = userMessage.length > MAX_MESSAGE_LENGTH
    ? userMessage.slice(0, MAX_MESSAGE_LENGTH) + '...'
    : userMessage;

  try {
    const content = await callLLM(
      {
        prompt,
        systemPrompt: CLASSIFIER_SYSTEM,
        model,
        max_tokens: 8
      },
      config
    );
    const s = (content && String(content).trim()) || '';
    const match = s.match(/[1-5]/);
    if (match) return Math.min(5, Math.max(1, parseInt(match[0], 10)));
  } catch (e) {
    // timeout, API error, etc. -> default to action
  }
  return 1;
}

/**
 * Choose tier from complexity score and config threshold.
 * @param {number} score - 1-5 from classifyComplexity
 * @param {Object} config - Swarm config
 * @returns {'reasoning'|'action'}
 */
function tierFromScore(score, config) {
  const threshold = (config?.model_routing?.complexity_threshold != null)
    ? config.model_routing.complexity_threshold
    : 4;
  return score >= threshold ? 'reasoning' : 'action';
}

module.exports = { classifyComplexity, tierFromScore };
