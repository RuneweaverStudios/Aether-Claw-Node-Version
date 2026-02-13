#!/usr/bin/env python3
"""
Aether-Claw Git Worktree Manager

Manages Git worktrees for worker isolation during task execution.
"""

import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@dataclass
class WorktreeInfo:
    """Information about a worktree."""
    path: str
    branch: str
    commit: str
    created_at: str


class WorktreeManager:
    """Manages Git worktrees for worker isolation."""

    def __init__(self, repo_path: Optional[Path] = None, prefix: str = "aether-worker"):
        """
        Initialize the worktree manager.

        Args:
            repo_path: Path to the repository (default: current directory)
            prefix: Prefix for worktree branch names
        """
        self.repo_path = Path(repo_path) if repo_path else Path.cwd()
        self.prefix = prefix

        if not self._is_git_repo():
            raise ValueError(f"Not a git repository: {self.repo_path}")

    def _is_git_repo(self) -> bool:
        """Check if the path is a git repository."""
        return (self.repo_path / '.git').exists()

    def _run_git(self, args: list[str], cwd: Optional[Path] = None) -> tuple[bool, str]:
        """Run a git command."""
        try:
            result = subprocess.run(
                ['git'] + args,
                cwd=cwd or self.repo_path,
                capture_output=True,
                text=True,
                timeout=30
            )
            return result.returncode == 0, result.stdout.strip()
        except subprocess.TimeoutExpired:
            return False, "Command timed out"
        except Exception as e:
            return False, str(e)

    def _generate_branch_name(self, worker_id: str) -> str:
        """Generate a unique branch name for a worker."""
        timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        return f"{self.prefix}/{worker_id}-{timestamp}"

    def create_worktree(
        self,
        worker_id: str,
        base_branch: str = "main"
    ) -> Path:
        """
        Create a new worktree for a worker.

        Args:
            worker_id: Unique identifier for the worker
            base_branch: Base branch to create from

        Returns:
            Path to the created worktree

        Raises:
            RuntimeError: If worktree creation fails
        """
        branch_name = self._generate_branch_name(worker_id)
        worktree_path = self.repo_path.parent / f".worktree-{worker_id}"

        # Check if base branch exists
        success, _ = self._run_git(['rev-parse', '--verify', base_branch])
        if not success:
            # Try with origin prefix
            success, _ = self._run_git(['rev-parse', '--verify', f'origin/{base_branch}'])
            if not success:
                raise RuntimeError(f"Base branch '{base_branch}' does not exist")

        # Create new branch
        success, output = self._run_git([
            'branch', branch_name, base_branch
        ])
        if not success:
            raise RuntimeError(f"Failed to create branch: {output}")

        # Create worktree
        success, output = self._run_git([
            'worktree', 'add', str(worktree_path), branch_name
        ])
        if not success:
            # Cleanup branch if worktree creation fails
            self._run_git(['branch', '-D', branch_name])
            raise RuntimeError(f"Failed to create worktree: {output}")

        logger.info(f"Created worktree at {worktree_path} on branch {branch_name}")

        self._log_to_audit(
            action="WORKTREE_CREATED",
            details=f"Worker {worker_id}: {worktree_path}"
        )

        return worktree_path

    def remove_worktree(self, worktree_path: Path) -> bool:
        """
        Remove a worktree and optionally its branch.

        Args:
            worktree_path: Path to the worktree to remove

        Returns:
            True if successful, False otherwise
        """
        worktree_path = Path(worktree_path)

        # Get branch name before removing
        success, branch = self._run_git(
            ['branch', '--show-current'],
            cwd=worktree_path
        )

        # Remove worktree
        success, output = self._run_git([
            'worktree', 'remove', str(worktree_path), '--force'
        ])

        if not success:
            logger.warning(f"Failed to remove worktree: {output}")
            # Try prune as fallback
            self._run_git(['worktree', 'prune'])

        # Remove the directory if it still exists
        if worktree_path.exists():
            try:
                import shutil
                shutil.rmtree(worktree_path)
            except Exception as e:
                logger.warning(f"Failed to remove worktree directory: {e}")

        # Optionally delete the branch
        if branch and branch.startswith(self.prefix):
            self._run_git(['branch', '-D', branch])

        logger.info(f"Removed worktree at {worktree_path}")

        self._log_to_audit(
            action="WORKTREE_REMOVED",
            details=str(worktree_path)
        )

        return True

    def list_worktrees(self) -> list[WorktreeInfo]:
        """
        List all active worktrees.

        Returns:
            List of WorktreeInfo objects
        """
        success, output = self._run_git(['worktree', 'list', '--porcelain'])

        if not success:
            return []

        worktrees = []
        current_path = None
        current_branch = None
        current_commit = None

        for line in output.split('\n'):
            if line.startswith('worktree '):
                current_path = line.split(' ', 1)[1]
            elif line.startswith('HEAD '):
                current_commit = line.split(' ', 1)[1]
            elif line.startswith('branch '):
                branch_ref = line.split(' ', 1)[1]
                # Extract branch name from refs/heads/branch-name
                if branch_ref.startswith('refs/heads/'):
                    current_branch = branch_ref.replace('refs/heads/', '')
                else:
                    current_branch = branch_ref
            elif line == '' and current_path:
                # End of entry
                if current_branch and self.prefix in current_branch:
                    worktrees.append(WorktreeInfo(
                        path=current_path,
                        branch=current_branch or 'detached',
                        commit=current_commit or 'unknown',
                        created_at='unknown'
                    ))
                current_path = None
                current_branch = None
                current_commit = None

        return worktrees

    def cleanup_all(self) -> int:
        """
        Remove all worktrees created by this manager.

        Returns:
            Number of worktrees removed
        """
        worktrees = self.list_worktrees()
        removed = 0

        for wt in worktrees:
            try:
                self.remove_worktree(Path(wt.path))
                removed += 1
            except Exception as e:
                logger.error(f"Failed to remove worktree {wt.path}: {e}")

        logger.info(f"Cleaned up {removed} worktrees")
        return removed

    def _log_to_audit(self, action: str, details: str) -> None:
        """Log to audit log if available."""
        try:
            from audit_logger import log_action
            log_action(
                level="INFO",
                agent="WorktreeManager",
                action=action,
                details=details
            )
        except ImportError:
            pass


def main():
    """CLI entry point for worktree manager."""
    import argparse

    parser = argparse.ArgumentParser(description='Aether-Claw Worktree Manager')
    parser.add_argument(
        '--create',
        type=str,
        metavar='WORKER_ID',
        help='Create a worktree for a worker'
    )
    parser.add_argument(
        '--remove',
        type=str,
        metavar='PATH',
        help='Remove a worktree'
    )
    parser.add_argument(
        '--list',
        action='store_true',
        help='List all worktrees'
    )
    parser.add_argument(
        '--cleanup',
        action='store_true',
        help='Remove all managed worktrees'
    )
    parser.add_argument(
        '--base-branch',
        type=str,
        default='main',
        help='Base branch for new worktrees'
    )

    args = parser.parse_args()

    try:
        manager = WorktreeManager()
    except ValueError as e:
        print(f"Error: {e}")
        return

    if args.create:
        try:
            path = manager.create_worktree(args.create, args.base_branch)
            print(f"Created worktree: {path}")
        except RuntimeError as e:
            print(f"Error: {e}")

    elif args.remove:
        manager.remove_worktree(Path(args.remove))
        print(f"Removed worktree: {args.remove}")

    elif args.list:
        worktrees = manager.list_worktrees()
        if not worktrees:
            print("No managed worktrees found")
        else:
            print(f"Found {len(worktrees)} worktrees:")
            for wt in worktrees:
                print(f"  {wt.path}")
                print(f"    Branch: {wt.branch}")
                print(f"    Commit: {wt.commit}")

    elif args.cleanup:
        removed = manager.cleanup_all()
        print(f"Removed {removed} worktrees")

    else:
        parser.print_help()


if __name__ == '__main__':
    main()
