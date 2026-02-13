#!/usr/bin/env python3
"""
Aether-Claw GLM API Client

Client for interacting with GLM-4 models via API for swarm agents.
"""

import json
import logging
import os
import time
from dataclasses import dataclass
from enum import Enum
from typing import Optional, Any
import urllib.request
import urllib.error

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# API Configuration
DEFAULT_API_KEY = ""  # Set via GLM_API_KEY environment variable
DEFAULT_BASE_URL = "https://openrouter.ai/api/v1/"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/"
ZAI_BASE_URL = "https://api.z.ai/api/paas/v4/"


class ModelTier(str, Enum):
    """Available model tiers."""
    TIER_1_REASONING = "tier_1_reasoning"
    TIER_2_ACTION = "tier_2_action"


@dataclass
class ModelConfig:
    """Configuration for a model tier."""
    model: str
    max_tokens: int
    temperature: float


# Default model configurations
# Using OpenRouter models - can be changed to Z.ai by setting base_url
MODEL_CONFIGS = {
    ModelTier.TIER_1_REASONING: ModelConfig(
        model="anthropic/claude-3.7-sonnet",
        max_tokens=4096,
        temperature=0.3
    ),
    ModelTier.TIER_2_ACTION: ModelConfig(
        model="anthropic/claude-3.7-haiku",
        max_tokens=2048,
        temperature=0.5
    )
}


@dataclass
class APIResponse:
    """Response from the GLM API."""
    success: bool
    content: str
    model: str
    usage: Optional[dict] = None
    error: Optional[str] = None
    latency_ms: Optional[float] = None


class GLMClient:
    """Client for interacting with GLM-4 API."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None
    ):
        """
        Initialize the GLM client.

        Args:
            api_key: API key (defaults to environment or default)
            base_url: Base URL for API (defaults to OpenRouter endpoint)
        """
        # Prefer OpenRouter API key, fall back to GLM_API_KEY
        self.api_key = api_key or os.environ.get('OPENROUTER_API_KEY') or os.environ.get('GLM_API_KEY', DEFAULT_API_KEY)
        self.base_url = base_url or DEFAULT_BASE_URL

        # Retry configuration
        self.max_retries = 3
        self.retry_base_delay = 1.0
        self.retry_max_delay = 30.0

        # Statistics
        self._stats = {
            'total_calls': 0,
            'successful_calls': 0,
            'failed_calls': 0,
            'total_tokens': 0,
            'total_latency_ms': 0.0
        }

    def _log_to_audit(self, action: str, details: str, level: str = "INFO") -> None:
        """Log to audit log if available."""
        try:
            from audit_logger import log_action
            log_action(
                level=level,
                agent="GLMClient",
                action=action,
                details=details
            )
        except ImportError:
            logger.info(f"[Audit] {action}: {details}")

    def _make_request(
        self,
        messages: list[dict],
        model: str,
        max_tokens: int,
        temperature: float
    ) -> dict:
        """
        Make a request to the GLM API.

        Args:
            messages: List of message dictionaries
            model: Model name
            max_tokens: Maximum tokens to generate
            temperature: Temperature for generation

        Returns:
            Response dictionary
        """
        url = f"{self.base_url}chat/completions"

        payload = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "HTTP-Referer": "https://github.com/aether-claw",
            "X-Title": "Aether-Claw"
        }

        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            url,
            data=data,
            headers=headers,
            method='POST'
        )

        with urllib.request.urlopen(req, timeout=120) as response:
            return json.loads(response.read().decode('utf-8'))

    def call(
        self,
        prompt: str,
        tier: ModelTier = ModelTier.TIER_1_REASONING,
        system_prompt: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None
    ) -> APIResponse:
        """
        Call the GLM API with a prompt.

        Args:
            prompt: User prompt
            tier: Model tier to use
            system_prompt: Optional system prompt
            max_tokens: Override max tokens
            temperature: Override temperature

        Returns:
            APIResponse object
        """
        self._stats['total_calls'] += 1
        start_time = time.time()

        # Get model config
        config = MODEL_CONFIGS.get(tier, MODEL_CONFIGS[ModelTier.TIER_1_REASONING])

        model = config.model
        tokens = max_tokens or config.max_tokens
        temp = temperature if temperature is not None else config.temperature

        # Build messages
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        # Retry logic
        last_error = None
        for attempt in range(self.max_retries):
            try:
                response = self._make_request(messages, model, tokens, temp)

                # Extract content
                content = response.get('choices', [{}])[0].get('message', {}).get('content', '')
                usage = response.get('usage', {})

                latency = (time.time() - start_time) * 1000

                # Update stats
                self._stats['successful_calls'] += 1
                self._stats['total_tokens'] += usage.get('total_tokens', 0)
                self._stats['total_latency_ms'] += latency

                self._log_to_audit(
                    action="API_CALL",
                    details=f"Model: {model}, Tokens: {usage.get('total_tokens', 0)}"
                )

                return APIResponse(
                    success=True,
                    content=content,
                    model=model,
                    usage=usage,
                    latency_ms=latency
                )

            except urllib.error.HTTPError as e:
                last_error = f"HTTP {e.code}: {e.reason}"
                logger.warning(f"API call failed (attempt {attempt + 1}): {last_error}")

            except urllib.error.URLError as e:
                last_error = f"URL Error: {e.reason}"
                logger.warning(f"API call failed (attempt {attempt + 1}): {last_error}")

            except Exception as e:
                last_error = str(e)
                logger.warning(f"API call failed (attempt {attempt + 1}): {last_error}")

            # Exponential backoff
            if attempt < self.max_retries - 1:
                delay = min(
                    self.retry_base_delay * (2 ** attempt),
                    self.retry_max_delay
                )
                time.sleep(delay)

        # All retries failed
        self._stats['failed_calls'] += 1
        latency = (time.time() - start_time) * 1000

        self._log_to_audit(
            action="API_CALL_FAILED",
            details=f"Model: {model}, Error: {last_error}",
            level="ERROR"
        )

        return APIResponse(
            success=False,
            content="",
            model=model,
            error=last_error,
            latency_ms=latency
        )

    def call_reasoning(
        self,
        prompt: str,
        system_prompt: Optional[str] = None
    ) -> APIResponse:
        """
        Call using tier 1 (reasoning) model.

        Args:
            prompt: User prompt
            system_prompt: Optional system prompt

        Returns:
            APIResponse object
        """
        return self.call(prompt, ModelTier.TIER_1_REASONING, system_prompt)

    def call_action(
        self,
        prompt: str,
        system_prompt: Optional[str] = None
    ) -> APIResponse:
        """
        Call using tier 2 (action) model.

        Args:
            prompt: User prompt
            system_prompt: Optional system prompt

        Returns:
            APIResponse object
        """
        return self.call(prompt, ModelTier.TIER_2_ACTION, system_prompt)

    def get_stats(self) -> dict:
        """Get API call statistics."""
        stats = self._stats.copy()
        if stats['successful_calls'] > 0:
            stats['avg_latency_ms'] = stats['total_latency_ms'] / stats['successful_calls']
        else:
            stats['avg_latency_ms'] = 0
        return stats

    def reset_stats(self) -> None:
        """Reset statistics."""
        self._stats = {
            'total_calls': 0,
            'successful_calls': 0,
            'failed_calls': 0,
            'total_tokens': 0,
            'total_latency_ms': 0.0
        }


# Global instance for convenience
_global_client: Optional[GLMClient] = None


def get_glm_client() -> GLMClient:
    """Get the global GLM client instance."""
    global _global_client
    if _global_client is None:
        _global_client = GLMClient()
    return _global_client


def call_glm(
    prompt: str,
    tier: ModelTier = ModelTier.TIER_1_REASONING,
    system_prompt: Optional[str] = None
) -> str:
    """
    Convenience function to call GLM API.

    Args:
        prompt: User prompt
        tier: Model tier
        system_prompt: Optional system prompt

    Returns:
        Generated content string
    """
    client = get_glm_client()
    response = client.call(prompt, tier, system_prompt)
    return response.content


def main():
    """CLI entry point for GLM client."""
    import argparse

    parser = argparse.ArgumentParser(description='Aether-Claw GLM Client')
    parser.add_argument(
        '--prompt', '-p',
        type=str,
        help='Prompt to send to the API'
    )
    parser.add_argument(
        '--tier', '-t',
        type=str,
        choices=['tier_1', 'tier_2'],
        default='tier_1',
        help='Model tier to use'
    )
    parser.add_argument(
        '--system',
        type=str,
        help='System prompt'
    )
    parser.add_argument(
        '--stats',
        action='store_true',
        help='Show API statistics'
    )

    args = parser.parse_args()

    client = GLMClient()

    if args.stats:
        stats = client.get_stats()
        print("GLM API Statistics:")
        for key, value in stats.items():
            print(f"  {key}: {value}")

    elif args.prompt:
        tier = ModelTier.TIER_1_REASONING if args.tier == 'tier_1' else ModelTier.TIER_2_ACTION
        response = client.call(args.prompt, tier, args.system)

        if response.success:
            print(response.content)
            print(f"\n---")
            print(f"Model: {response.model}")
            print(f"Latency: {response.latency_ms:.0f}ms")
            if response.usage:
                print(f"Tokens: {response.usage.get('total_tokens', 'N/A')}")
        else:
            print(f"Error: {response.error}")

    else:
        parser.print_help()


if __name__ == '__main__':
    main()
