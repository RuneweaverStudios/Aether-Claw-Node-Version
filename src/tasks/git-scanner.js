/**
 * Aether-Claw Git Scanner (Node)
 * Scan repos for uncommitted changes, unpushed commits, stale branches.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function runGit(repoPath, args) {
  try {
    const out = execSync('git', args, { cwd: repoPath, encoding: 'utf8', timeout: 30000 });
    return [true, (out || '').trim()];
  } catch (e) {
    return [false, e.message || ''];
  }
}

function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

function getCurrentBranch(repoPath) {
  const [ok, out] = runGit(repoPath, ['branch', '--show-current']);
  return ok ? out : 'unknown';
}

function getUncommittedChanges(repoPath) {
  const [ok, out] = runGit(repoPath, ['status', '--porcelain']);
  if (!ok) return 0;
  return out.split('\n').filter(l => l.trim()).length;
}

function getUnpushedCommits(repoPath) {
  const branch = getCurrentBranch(repoPath);
  if (branch === 'unknown') return 0;
  const [ok, out] = runGit(repoPath, ['log', `origin/${branch}..HEAD`, '--oneline']);
  if (!ok) return 0;
  return out.split('\n').filter(l => l.trim()).length;
}

function getStaleBranches(repoPath, days = 30) {
  const [ok, out] = runGit(repoPath, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short) %(committerdate:iso)', 'refs/heads/']);
  if (!ok) return [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const stale = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split(/\s+/);
    if (parts.length >= 2) {
      const dateStr = parts.slice(1).join(' ').replace('Z', '+00:00');
      const d = new Date(dateStr);
      if (!isNaN(d.getTime()) && d < cutoff) stale.push(parts[0]);
    }
  }
  return stale;
}

function scanRepository(repoPath) {
  const issues = [];
  const uncommitted = getUncommittedChanges(repoPath);
  if (uncommitted > 0) issues.push({ repo_path: repoPath, issue_type: 'uncommitted_changes', description: `Has ${uncommitted} uncommitted changes`, severity: uncommitted < 10 ? 'medium' : 'high' });
  const unpushed = getUnpushedCommits(repoPath);
  if (unpushed > 0) issues.push({ repo_path: repoPath, issue_type: 'unpushed_commits', description: `Has ${unpushed} unpushed commits`, severity: unpushed < 5 ? 'low' : 'medium' });
  const stale = getStaleBranches(repoPath);
  if (stale.length > 3) issues.push({ repo_path: repoPath, issue_type: 'stale_branches', description: `Has ${stale.length} stale branches (>30 days)`, severity: 'low' });
  return {
    path: repoPath,
    branch: getCurrentBranch(repoPath),
    is_clean: issues.length === 0,
    uncommitted_changes: uncommitted,
    unpushed_commits: unpushed,
    stale_branches: stale,
    issues
  };
}

function findRepositories(searchPath, maxDepth = 3) {
  const repos = [];
  function search(dir, depth) {
    if (depth > maxDepth) return;
    try {
      if (isGitRepo(dir)) {
        repos.push(dir);
        return;
      }
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.')) search(path.join(dir, e.name), depth + 1);
      }
    } catch (e) {}
  }
  search(searchPath, 0);
  return repos;
}

function scanAllRepositories(searchPath = process.cwd()) {
  const repos = findRepositories(searchPath);
  return repos.map(r => scanRepository(r));
}

module.exports = { scanRepository, scanAllRepositories, findRepositories, isGitRepo };
