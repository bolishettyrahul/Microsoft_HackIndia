from __future__ import annotations

from datetime import datetime, timedelta, timezone

from baton.ai.chain import RuntimeModelChain
from baton.interfaces.ai import ModelProfile, ModelState
from baton.interfaces.errors import RateLimited
from baton.interfaces.types import Completion


class _Clock:
    def __init__(self) -> None:
        self.value = datetime(2026, 1, 1, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        return self.value


class _Model:
    def __init__(self, model_id: str, *, burstable: bool = True, fail_on: int | None = None) -> None:
        provider, name = model_id.split(":", 1)
        self._profile = ModelProfile(
            id=model_id,
            label=name,
            provider=provider,
            model=name,
            base_url="https://example.test",
            burstable=burstable,
        )
        self.calls = 0
        self.fail_on = fail_on

    @property
    def profile(self) -> ModelProfile:
        return self._profile

    def complete(self, messages, *, max_tokens=None, json_schema=None) -> Completion:
        self.calls += 1
        if self.calls == self.fail_on:
            raise RateLimited(self.profile.id, 12)
        return Completion(text="ok", model_id=self.profile.id, latency_ms=1)


def test_candidate_order_cooldown_expiry_and_session_bench() -> None:
    clock = _Clock()
    models = [_Model("groq:a"), _Model("gemini:b", burstable=False), _Model("groq:c")]
    chain = RuntimeModelChain(models, clock=clock)
    chain.set_active("one", "gemini:b")

    assert [model.profile.id for model in chain.candidates("one")] == [
        "gemini:b",
        "groq:c",
        "groq:a",
    ]

    chain.cool_down("gemini:b", 10)
    assert [model.profile.id for model in chain.candidates("one")] == ["groq:c", "groq:a"]
    assert chain.status("one")[1].state == ModelState.COOLING

    clock.value += timedelta(seconds=11)
    assert chain.status("one")[1].state == ModelState.READY
    chain.bench("one", "gemini:b")
    assert "gemini:b" not in [model.profile.id for model in chain.candidates("one")]
    assert "gemini:b" in [model.profile.id for model in chain.candidates("two")]


def test_burst_stops_on_429_and_sets_cooldown() -> None:
    model = _Model("groq:a", fail_on=2)
    chain = RuntimeModelChain([model], burst_tokens=10)

    result = chain.burst("groq:a")

    assert result.got_429 is True
    assert result.requests == 2
    assert result.tokens_sent == 20
    assert result.retry_after == 12
    assert chain.status("session")[0].state == ModelState.COOLING
