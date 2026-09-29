"""Minimal real-provider checks. Run explicitly with ``pytest -m live tests/live``."""

from __future__ import annotations

import time
from uuid import uuid4

import pytest

from baton.ai.build import _profile
from baton.ai.extractor import StructuredExtractor
from baton.ai.hindsight import HindsightLongTermMemory
from baton.ai.provider import OpenAICompatModel
from baton.config import Settings, load_settings
from baton.interfaces.types import Item, ItemKind, Message, new_id, utcnow

pytestmark = pytest.mark.live


def _provider_key(settings: Settings, provider: str) -> str | None:
    if provider == "groq":
        return settings.groq_api_key
    if provider == "gemini":
        return settings.gemini_api_key
    return None


def _live_model(settings: Settings, model_id: str) -> OpenAICompatModel:
    profile = _profile(model_id)
    key = _provider_key(settings, profile.provider)
    if not key:
        variable = "GROQ_API_KEY" if profile.provider == "groq" else "GEMINI_API_KEY"
        pytest.skip(f"{variable} is not configured")
    return OpenAICompatModel(profile, key)


@pytest.mark.parametrize(
    "model_id",
    (
        "groq:openai/gpt-oss-120b",
        "gemini:gemini-3.5-flash",
        "groq:qwen/qwen3.8-27b",
    ),
)
def test_each_chat_model_returns_text(model_id: str) -> None:
    settings = load_settings()
    model = _live_model(settings, model_id)

    result = model.complete(
        [Message(role="user", content="Reply with exactly: baton-ready")],
        # Gemini 3.x always thinks and can consume a tiny completion allowance
        # without emitting visible text. Production uses a 1,024-token cap.
        max_tokens=256 if model.profile.provider == "gemini" else 40,
    )

    assert result.text.strip()
    assert result.model_id == model_id
    assert 0 <= result.latency_ms < 120_000
    print(f"{model_id} latency_ms={result.latency_ms}")


@pytest.mark.parametrize(
    "model_id",
    (
        "groq:openai/gpt-oss-20b",
        "gemini:gemini-3.5-flash-lite",
    ),
)
def test_each_extractor_model_returns_rejection_with_reason(model_id: str) -> None:
    settings = load_settings()
    model = _live_model(settings, model_id)
    extractor = StructuredExtractor([model])

    result = extractor.extract(
        user_msg="No Redis, we're on a free tier; use an in-process cache.",
        reply="Understood. I will use an in-process cache instead of Redis.",
        contract_text="Goal: add caching",
    )

    assert not result.alerts
    rejection = next(item for item in result.items if item.kind == "rejection")
    assert "redis" in rejection.text.casefold()
    assert rejection.reason
    print(f"{model_id} extractor_model={result.extractor_model}")


def test_hindsight_retain_recall_preserves_item_metadata() -> None:
    settings = load_settings()
    if not settings.hindsight_api_key:
        pytest.skip("HINDSIGHT_API_KEY is not configured")

    project = "baton-live-test"
    session_id = f"live-{uuid4().hex[:10]}"
    rejection = Item(
        id=new_id(),
        kind=ItemKind.REJECTION,
        text="Redis",
        reason="free tier",
        aliases=("redis cache", "elasticache"),
        session_id=session_id,
        project=project,
        user="Live test",
        turn=1,
        model="groq:openai/gpt-oss-120b",
        created_at=utcnow(),
    )
    next_step = Item(
        id=new_id(),
        kind=ItemKind.NEXT_STEP,
        text="Implement the in-process cache",
        session_id=session_id,
        project=project,
        user="Live test",
        turn=1,
        model="groq:openai/gpt-oss-120b",
        created_at=utcnow(),
    )
    expected = {rejection.id: rejection, next_step.id: next_step}
    memory = HindsightLongTermMemory(
        settings.hindsight_base_url,
        settings.hindsight_api_key,
    )
    try:
        assert memory.ensure_bank(project) == []
        started = time.monotonic()
        memory.retain(project, f"{session_id}:1", tuple(expected.values()))

        found: dict[str, Item] = {}
        deadline = started + 30.0
        while time.monotonic() < deadline:
            snapshot = memory.snapshot(project, timeout=settings.recall_timeout)
            assert not snapshot.alerts
            found = {item.id: item for item in snapshot.items if item.id in expected}
            if found.keys() == expected.keys():
                break
            time.sleep(1.0)

        delay = time.monotonic() - started
        assert found.keys() == expected.keys(), "items were not recallable within 30 seconds"
        assert found[rejection.id].kind == ItemKind.REJECTION
        assert found[rejection.id].aliases == rejection.aliases
        assert found[next_step.id].kind == ItemKind.NEXT_STEP
        print(f"Hindsight retain_to_recall_seconds={delay:.2f}")
    finally:
        memory.close()
