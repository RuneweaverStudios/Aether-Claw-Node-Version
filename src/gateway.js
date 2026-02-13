/**
 * Gateway: route user prompts to the right action (OpenClaw-style).
 * Classifies intent so chat uses reasoning model, code/tasks use action model,
 * memory queries get search + optional LLM, and planning gets reflect prompt.
 */

const ACTION_KEYWORDS = [
  'write code', 'generate code', 'implement', 'script', 'function to',
  'write a script', 'create a script', 'code that', 'snippet', 'example code',
  'fix this code', 'refactor', 'debug', 'implement a', 'write me code',
  'quick task', 'run a task', 'execute', 'command to'
];

const MEMORY_KEYWORDS = [
  'remember', 'recall', 'what did we', 'what did i', 'remind me',
  'do you remember', 'from memory', 'search memory', 'look up',
  'last time', 'previously', 'earlier we', 'my notes', 'in my'
];

const REFLECT_KEYWORDS = [
  'plan', 'break down', 'steps to', 'how should i', 'outline',
  'decompose', 'strategy', 'approach for', 'think through',
  'consider', 'options for', 'pros and cons', 'decide'
];

function classifyIntent(text) {
  const lower = text.toLowerCase().trim();
  if (lower.length < 2) return { action: 'chat', query: text };

  for (const kw of ACTION_KEYWORDS) {
    if (lower.includes(kw)) return { action: 'action', query: text };
  }
  for (const kw of MEMORY_KEYWORDS) {
    if (lower.includes(kw)) return { action: 'memory', query: text };
  }
  for (const kw of REFLECT_KEYWORDS) {
    if (lower.includes(kw)) return { action: 'reflect', query: text };
  }

  return { action: 'chat', query: text };
}

/**
 * Route a user message to an action type.
 * @param {string} userMessage - Raw user input
 * @returns {{ action: 'chat'|'action'|'memory'|'reflect', query: string }}
 */
function routePrompt(userMessage) {
  return classifyIntent(userMessage);
}

module.exports = { routePrompt, classifyIntent };
