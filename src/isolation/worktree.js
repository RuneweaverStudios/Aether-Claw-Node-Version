/**
 * Worktree isolation (Node stub).
 * Full implementation would use git worktree for sandboxed execution.
 */

function createWorktree(repoPath, branch) {
  return Promise.resolve({ path: repoPath, branch });
}

function removeWorktree(worktreePath) {
  return Promise.resolve();
}

module.exports = { createWorktree, removeWorktree };
