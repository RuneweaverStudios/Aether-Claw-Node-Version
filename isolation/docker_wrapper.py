#!/usr/bin/env python3
"""
Aether-Claw Docker Isolation Wrapper

Provides Docker-based isolation for worker execution.
"""

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Any

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Try to import docker
try:
    import docker
    from docker.models.containers import Container
    DOCKER_AVAILABLE = True
except ImportError:
    DOCKER_AVAILABLE = False
    logger.warning("docker package not installed, Docker isolation unavailable")


@dataclass
class ContainerConfig:
    """Configuration for a worker container."""
    image: str = "python:3.11-slim"
    cpu_quota: int = 50000  # 50% of CPU
    memory_limit: str = "512m"
    network_enabled: bool = False
    timeout: int = 300  # 5 minutes
    workdir: str = "/workspace"


@dataclass
class ExecutionResult:
    """Result of container execution."""
    success: bool
    exit_code: int
    output: str
    error: str
    duration_seconds: float


class DockerIsolation:
    """Provides Docker-based isolation for worker execution."""

    def __init__(self, config: Optional[ContainerConfig] = None):
        """
        Initialize Docker isolation.

        Args:
            config: Container configuration

        Raises:
            RuntimeError: If Docker is not available
        """
        if not DOCKER_AVAILABLE:
            raise RuntimeError("Docker package not installed. Run: pip install docker")

        self.config = config or ContainerConfig()

        try:
            self.client = docker.from_env()
            self.client.ping()
        except Exception as e:
            raise RuntimeError(f"Failed to connect to Docker: {e}")

    def _log_to_audit(self, action: str, details: str) -> None:
        """Log to audit log if available."""
        try:
            from audit_logger import log_action
            log_action(
                level="INFO",
                agent="DockerIsolation",
                action=action,
                details=details
            )
        except ImportError:
            pass

    def create_container(
        self,
        worker_id: str,
        command: Optional[list[str]] = None,
        volumes: Optional[dict] = None
    ) -> Container:
        """
        Create a container for a worker.

        Args:
            worker_id: Unique identifier for the worker
            command: Command to run in the container
            volumes: Volume mappings {host_path: {'bind': container_path, 'mode': 'rw'}}

        Returns:
            Container object
        """
        container_name = f"aether-worker-{worker_id}"

        # Build container configuration
        container_config = {
            'image': self.config.image,
            'name': container_name,
            'detach': True,
            'working_dir': self.config.workdir,
            'command': command or ['/bin/bash', '-c', 'sleep infinity'],
        }

        # Resource limits and security options
        mem_limit = self.config.memory_limit
        cpu_quota = self.config.cpu_quota
        security_opt = ['no-new-privileges']
        cap_drop = ['ALL']
        network_mode = 'none' if not self.config.network_enabled else None

        # Create container
        try:
            container = self.client.containers.create(
                **container_config,
                mem_limit=mem_limit,
                cpu_quota=cpu_quota,
                security_opt=security_opt,
                cap_drop=cap_drop,
                network_mode=network_mode,
                volumes=volumes
            )

            logger.info(f"Created container {container_name}")

            self._log_to_audit(
                action="CONTAINER_CREATED",
                details=f"Worker {worker_id}: {container_name}"
            )

            return container

        except Exception as e:
            logger.error(f"Failed to create container: {e}")
            raise

    def run_in_container(
        self,
        container: Container,
        command: str
    ) -> ExecutionResult:
        """
        Run a command in a container.

        Args:
            container: Container to run in
            command: Command to execute

        Returns:
            ExecutionResult with output and status
        """
        import time

        start_time = time.time()

        try:
            # Start container if not running
            container.reload()
            if container.status != 'running':
                container.start()

            # Execute command
            exit_code, output = container.exec_run(
                cmd=['/bin/bash', '-c', command],
                workdir=self.config.workdir,
                timeout=self.config.timeout
            )

            duration = time.time() - start_time

            result = ExecutionResult(
                success=exit_code == 0,
                exit_code=exit_code,
                output=output.decode('utf-8') if isinstance(output, bytes) else str(output),
                error='',
                duration_seconds=duration
            )

            self._log_to_audit(
                action="CONTAINER_EXEC",
                details=f"Command: {command[:50]}..., Exit code: {exit_code}"
            )

            return result

        except Exception as e:
            duration = time.time() - start_time

            return ExecutionResult(
                success=False,
                exit_code=-1,
                output='',
                error=str(e),
                duration_seconds=duration
            )

    def cleanup_container(self, container: Container) -> None:
        """
        Stop and remove a container.

        Args:
            container: Container to cleanup
        """
        try:
            container.stop(timeout=5)
            container.remove(force=True)

            logger.info(f"Cleaned up container {container.name}")

            self._log_to_audit(
                action="CONTAINER_CLEANED",
                details=container.name
            )

        except Exception as e:
            logger.warning(f"Failed to cleanup container: {e}")

    def list_worker_containers(self) -> list[dict]:
        """
        List all worker containers.

        Returns:
            List of container info dictionaries
        """
        containers = []

        try:
            for container in self.client.containers.list(all=True):
                if container.name.startswith('aether-worker-'):
                    containers.append({
                        'id': container.id[:12],
                        'name': container.name,
                        'status': container.status,
                        'image': container.image.tags[0] if container.image.tags else 'unknown'
                    })
        except Exception as e:
            logger.error(f"Failed to list containers: {e}")

        return containers

    def cleanup_all_workers(self) -> int:
        """
        Remove all worker containers.

        Returns:
            Number of containers removed
        """
        removed = 0

        for container_info in self.list_worker_containers():
            try:
                container = self.client.containers.get(container_info['id'])
                self.cleanup_container(container)
                removed += 1
            except Exception as e:
                logger.error(f"Failed to cleanup {container_info['name']}: {e}")

        return removed


def main():
    """CLI entry point for Docker wrapper."""
    import argparse

    parser = argparse.ArgumentParser(description='Aether-Claw Docker Isolation')
    parser.add_argument(
        '--list',
        action='store_true',
        help='List worker containers'
    )
    parser.add_argument(
        '--cleanup',
        action='store_true',
        help='Remove all worker containers'
    )
    parser.add_argument(
        '--test',
        action='store_true',
        help='Test Docker isolation'
    )

    args = parser.parse_args()

    if not DOCKER_AVAILABLE:
        print("Error: docker package not installed")
        print("Run: pip install docker")
        return

    try:
        isolation = DockerIsolation()
    except RuntimeError as e:
        print(f"Error: {e}")
        return

    if args.list:
        containers = isolation.list_worker_containers()
        if not containers:
            print("No worker containers found")
        else:
            print(f"Found {len(containers)} worker containers:")
            for c in containers:
                print(f"  {c['name']}: {c['status']} ({c['image']})")

    elif args.cleanup:
        removed = isolation.cleanup_all_workers()
        print(f"Removed {removed} containers")

    elif args.test:
        print("Testing Docker isolation...")
        try:
            container = isolation.create_container("test")
            result = isolation.run_in_container(container, "echo 'Hello from Docker!'")

            print(f"Output: {result.output}")
            print(f"Success: {result.success}")

            isolation.cleanup_container(container)
            print("Test completed successfully")

        except Exception as e:
            print(f"Test failed: {e}")

    else:
        parser.print_help()


if __name__ == '__main__':
    main()
