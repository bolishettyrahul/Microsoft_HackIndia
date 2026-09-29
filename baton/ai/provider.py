"""OpenAI-compatible chat adapter used for Groq and Gemini."""

from __future__ import annotations

import json
import re
import time
from collections.abc import Sequence
from typing import Any

import openai
from openai import OpenAI

from baton.interfaces.ai import ModelProfile
from baton.interfaces.errors import ModelUnavailable, RateLimited
from baton.interfaces.types import Completion, Message

_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)
_RETRY_DELAY = re.compile(r'"retryDelay"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)s?"?')


def strip_reasoning(text: str) -> str:
    """Remove provider reasoning blocks before verification or display."""
    return _THINK_BLOCK.sub("", text).strip()


def retry_after_seconds(error: BaseException, default: float = 60.0) -> float:
    """Read a provider retry delay from headers, then from a Gemini error body."""
    response = getattr(error, "response", None)
    headers = getattr(response, "headers", None)
    if headers:
        value = headers.get("retry-after")
        if value:
            try:
                return max(0.0, float(value))
            except (TypeError, ValueError):
                pass

    body = getattr(error, "body", None)
    if body is not None:
        try:
            text = json.dumps(body) if not isinstance(body, str) else body
        except (TypeError, ValueError):
            text = str(body)
        match = _RETRY_DELAY.search(text)
        if match:
            return max(0.0, float(match.group(1)))
    return default


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])
            else:
                value = getattr(part, "text", None)
                if isinstance(value, str):
                    parts.append(value)
        return "".join(parts)
    return "" if content is None else str(content)


class OpenAICompatModel:
    """A single provider model with SDK retries deliberately disabled."""

    def __init__(
        self,
        profile: ModelProfile,
        api_key: str | None,
        *,
        timeout: float = 60.0,
        client: Any | None = None,
    ) -> None:
        self._profile = profile
        self._api_key = api_key
        self._client = client
        if client is None and api_key:
            self._client = OpenAI(
                api_key=api_key,
                base_url=profile.base_url,
                max_retries=0,
                timeout=timeout,
            )

    @property
    def profile(self) -> ModelProfile:
        return self._profile

    def complete(
        self,
        messages: Sequence[Message],
        *,
        max_tokens: int | None = None,
        json_schema: dict | None = None,
    ) -> Completion:
        if self._client is None:
            raise ModelUnavailable(self.profile.id, "auth", "API key is not configured")

        request: dict[str, Any] = {
            "model": self.profile.model,
            "messages": [message.model_dump(mode="json") for message in messages],
        }
        if max_tokens is not None:
            request["max_completion_tokens"] = max_tokens
        if json_schema is not None:
            request["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": "baton_turn_items",
                    "strict": True,
                    "schema": json_schema,
                },
            }

        if self.profile.model.startswith("openai/gpt-oss") or self.profile.provider == "gemini":
            request["reasoning_effort"] = "low"
        elif self.profile.model.startswith("qwen/"):
            request["extra_body"] = {
                "reasoning_effort": "none",
                "reasoning_format": "hidden",
            }

        started = time.perf_counter()
        try:
            response = self._client.chat.completions.create(**request)
        except openai.RateLimitError as error:
            raise RateLimited(self.profile.id, retry_after_seconds(error)) from error
        except (openai.AuthenticationError, openai.PermissionDeniedError) as error:
            raise ModelUnavailable(self.profile.id, "auth", str(error)) from error
        except openai.BadRequestError as error:
            raise ModelUnavailable(self.profile.id, "bad_request", str(error)) from error
        except (openai.APITimeoutError, openai.APIConnectionError) as error:
            raise ModelUnavailable(self.profile.id, "error", str(error)) from error
        except openai.APIStatusError as error:
            reason = "auth" if error.status_code in (401, 403) else "bad_request" if error.status_code == 400 else "error"
            raise ModelUnavailable(self.profile.id, reason, str(error)) from error
        except Exception as error:
            # Provider SDKs occasionally surface transport-specific exceptions. The
            # boundary contract permits only Baton's two model exceptions to escape.
            raise ModelUnavailable(self.profile.id, "error", str(error)) from error

        latency_ms = max(0, round((time.perf_counter() - started) * 1000))
        choices = getattr(response, "choices", None) or ()
        if not choices:
            raise ModelUnavailable(self.profile.id, "error", "provider returned no choices")
        text = strip_reasoning(_content_text(choices[0].message.content))
        usage = getattr(response, "usage", None)
        return Completion(
            text=text,
            model_id=self.profile.id,
            prompt_tokens=getattr(usage, "prompt_tokens", None),
            completion_tokens=getattr(usage, "completion_tokens", None),
            latency_ms=latency_ms,
        )
