/**
 * Ralph-style autonomous PRD-driven loop: one story per iteration, progress.txt, COMPLETE detection.
 * Uses runAgentLoop with RALPH_SYSTEM and Ralph tools (ralph_get_next_story, ralph_mark_story_passed, ralph_append_progress).
 */

const path = require('path');
const fs = require('fs');
const { loadConfig } = require('./config');
const { runAgentLoop } = require('./agent-loop');
const { runTool } = require('./tools');

const ROOT_DEFAULT = path.resolve(__dirname, '..');
const COMPLETE_MARKER = '<promise>COMPLETE</promise>';
const LAST_BRANCH_FILE = '.last-ralph-branch';
const ARCHIVE_DIR = 'archive';

const RALPH_SYSTEM = `You are an autonomous coding agent running the Ralph workflow. Work on ONE user story per run.

## Ralph tools (use these)

1. **ralph_get_next_story** – Call this first. Returns the next story to implement (highest priority with passes: false) and the Codebase Patterns section from progress.txt. If all_complete is true, there is nothing left; reply with <promise>COMPLETE</promise>.

2. **ralph_mark_story_passed** – After implementing a story and passing quality checks, call this with the story_id to set passes: true in prd.json.

3. **ralph_append_progress** – After completing a story, append a progress entry with content: what was implemented, files changed, and **Learnings for future iterations** (patterns, gotchas, context). Use this so the next iteration benefits.

## Your task each run

1. Call ralph_get_next_story. If all_complete, reply with <promise>COMPLETE</promise> and stop.
2. Ensure git branch matches PRD branchName (use git_status, then exec to checkout/create branch if needed).
3. Implement the single user story from the returned story (read acceptanceCriteria, implement, run quality checks).
4. Run quality checks: use run_tests, lint, and/or exec for typecheck/lint/test as the project requires. Do NOT commit if checks fail.
5. If you discover reusable patterns, add them to the ## Codebase Patterns section at the TOP of progress.txt (read progress.txt, then write_file with the new top section + rest of file).
6. If checks pass: commit ALL changes with message "feat: [Story ID] - [Story Title]" using git_commit.
7. Call ralph_mark_story_passed with the story_id you completed.
8. Call ralph_append_progress with a summary and learnings (implementation summary, files changed, patterns/gotchas for future iterations).
9. Check if all stories are now complete (call ralph_get_next_story again). If all_complete, reply with <promise>COMPLETE</promise>. Otherwise end your response normally.

## Rules

- Work on ONE story per run. Do not start the next story.
- Do NOT commit broken code. Only commit after quality checks pass.
- Keep changes focused and minimal. Follow existing code patterns.
- Use read_file, write_file, edit, exec, git_*, run_tests, lint as needed for implementation.`;

function getPrdPath(root, config) {
  const ralph = config.ralph || {};
  const p = ralph.prd_path || 'prd.json';
  return path.isAbsolute(p) ? p : path.join(root, p);
}

function getProgressPath(root, config) {
  const ralph = config.ralph || {};
  const p = ralph.progress_path || 'progress.txt';
  return path.isAbsolute(p) ? p : path.join(root, p);
}

function ensureProgressFile(root, config) {
  const progressFp = getProgressPath(root, config);
  if (!fs.existsSync(progressFp)) {
    const header = '# Ralph Progress Log\nStarted: ' + new Date().toISOString() + '\n---\n';
    fs.writeFileSync(progressFp, header, 'utf8');
  }
}

function archivePreviousRun(root, config, lastBranch, prdPath, progressPath) {
  const archiveRoot = path.join(root, ARCHIVE_DIR);
  const date = new Date().toISOString().slice(0, 10);
  const folderName = (lastBranch || 'unknown').replace(/[/\\]/g, '-');
  const archiveFolder = path.join(archiveRoot, `${date}-${folderName}`);
  fs.mkdirSync(archiveFolder, { recursive: true });
  if (fs.existsSync(prdPath)) fs.copyFileSync(prdPath, path.join(archiveFolder, 'prd.json'));
  if (fs.existsSync(progressPath)) fs.copyFileSync(progressPath, path.join(archiveFolder, 'progress.txt'));
  const progressFp = getProgressPath(root, config);
  fs.writeFileSync(progressFp, '# Ralph Progress Log\nStarted: ' + new Date().toISOString() + '\n---\n', 'utf8');
  return archiveFolder;
}

function checkAllStoriesComplete(root, config) {
  const prdPath = getPrdPath(root, config);
  if (!fs.existsSync(prdPath)) return false;
  try {
    const prd = JSON.parse(fs.readFileSync(prdPath, 'utf8'));
    const stories = prd.userStories || [];
    return stories.length > 0 && stories.every((s) => s.passes === true);
  } catch (_) {
    return false;
  }
}

/**
 * Run the Ralph loop: maxIterations runs of the agent, each doing one story until COMPLETE or limit.
 * @param {string} workspaceRoot - Project root (default repo root)
 * @param {{ maxIterations?: number }} options
 * @returns {{ completed: boolean, iterations: number, lastReply?: string }}
 */
async function runRalph(workspaceRoot, options = {}) {
  const root = workspaceRoot || ROOT_DEFAULT;
  const config = loadConfig(path.join(root, 'swarm_config.json'));
  const maxIterations = options.maxIterations ?? config.ralph?.max_iterations ?? 10;
  const prdPath = getPrdPath(root, config);
  const progressPath = getProgressPath(root, config);

  if (!fs.existsSync(prdPath)) {
    throw new Error('prd.json not found at ' + prdPath + '. Create a PRD first (see prd.json.example).');
  }

  ensureProgressFile(root, config);

  const lastBranchFile = path.join(root, LAST_BRANCH_FILE);
  let lastBranch = null;
  if (fs.existsSync(lastBranchFile)) lastBranch = fs.readFileSync(lastBranchFile, 'utf8').trim();
  try {
    const prd = JSON.parse(fs.readFileSync(prdPath, 'utf8'));
    const currentBranch = prd.branchName || '';
    if (currentBranch && lastBranch && currentBranch !== lastBranch) {
      const archiveFolder = archivePreviousRun(root, config, lastBranch, prdPath, progressPath);
      if (options.onArchive) options.onArchive(archiveFolder);
    }
    if (currentBranch) fs.writeFileSync(lastBranchFile, currentBranch, 'utf8');
  } catch (_) {}

  if (checkAllStoriesComplete(root, config)) {
    return { completed: true, iterations: 0, message: 'All stories already complete.' };
  }

  for (let i = 1; i <= maxIterations; i++) {
    const userMessage = `Ralph iteration ${i} of ${maxIterations}. Execute the Ralph workflow: use ralph_get_next_story to get the next story (or confirm all complete). Implement that one story, run quality checks, commit, then ralph_mark_story_passed and ralph_append_progress. If all stories are complete, reply with ${COMPLETE_MARKER}.`;

    if (options.onIteration) options.onIteration(i, maxIterations);

    const result = await runAgentLoop(root, userMessage, RALPH_SYSTEM, config, {
      tier: 'action',
      max_tokens: 4096
    });
    const reply = (result.error ? result.error : result.reply) || '';

    if (reply.includes(COMPLETE_MARKER) || reply.includes('COMPLETE')) {
      return { completed: true, iterations: i, lastReply: reply };
    }

    if (options.onIterationDone) options.onIterationDone(i, reply, result);
  }

  return { completed: false, iterations: maxIterations, lastReply: undefined };
}

module.exports = {
  runRalph,
  RALPH_SYSTEM,
  getPrdPath,
  getProgressPath,
  ensureProgressFile,
  checkAllStoriesComplete,
  COMPLETE_MARKER
};
