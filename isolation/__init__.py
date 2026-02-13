"""
Aether-Claw Isolation Module

Provides isolation mechanisms for worker execution.
"""

from .worktree import WorktreeManager
from .docker_wrapper import DockerIsolation, ContainerConfig, ExecutionResult

__all__ = ['WorktreeManager', 'DockerIsolation', 'ContainerConfig', 'ExecutionResult']
