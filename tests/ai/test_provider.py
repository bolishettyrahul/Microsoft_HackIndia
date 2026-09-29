from __future__ import annotations

from types import SimpleNamespace

from baton.ai.provider import OpenAICompatModel, retry_after_seconds, strip_reasoning
from baton.interfaces.ai import ModelProfile
from baton.interfaces.types import Message


class _Completions:
    def __init__(self) -> None:
        self.request = None

    def create(self, **request):
        self.request = request
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="<think>secret</think>Answer"))],
            usage=SimpleNamespace(prompt_tokens=7, completion_tokens=2),
        )


def _profile() -> ModelProfile:
    return ModelProfile(
        id="groq:openai/gpt-oss-120b",
        label="gpt-oss-120b · Groq",
        provider="groq",
        model="openai/gpt-oss-120b",
        base_url="https://example.test/v1",
        burstable=True,
    )


def test_complete_builds_structured_request_and_strips_reasoning() -> None:
    completions = _Completions()
    client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    model = OpenAICompatModel(_profile(), "test-key", client=client)

    result = model.complete(
        [Message(role="user", content="hello")],
        max_tokens=25,
        json_schema={"type": "object", "properties": {}},
    )

    assert result.text == "Answer"
    assert result.prompt_tokens == 7
    assert result.completion_tokens == 2
    assert completions.request["max_completion_tokens"] == 25
    assert completions.request["reasoning_effort"] == "low"
    assert completions.request["response_format"]["json_schema"]["strict"] is True


def test_retry_delay_prefers_header_then_gemini_body() -> None:
    header_error = SimpleNamespace(response=SimpleNamespace(headers={"retry-after": "2.5"}), body=None)
    body_error = SimpleNamespace(response=None, body={"details": [{"retryDelay": "17s"}]})
    assert retry_after_seconds(header_error) == 2.5
    assert retry_after_seconds(body_error) == 17.0
    assert strip_reasoning("before<think>hidden</think>after") == "beforeafter"
