"""Thread-safe model selection, session benching and global cooldowns."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from datetime import datetime, timedelta, timezone
from threading import RLock

from baton.interfaces.ai import (
    BurstResult,
    ChatModel,
    ModelState,
    ModelStatus,
)
from baton.interfaces.errors import ModelUnavailable, RateLimited
from baton.interfaces.types import Message


def _now() -> datetime:
    return datetime.now(timezone.utc)


class RuntimeModelChain:
    """Model-chain state with per-session active/bench and global health."""

    def __init__(
        self,
        models: Sequence[ChatModel],
        *,
        clock: Callable[[], datetime] = _now,
        burst_requests: int = 6,
        burst_tokens: int = 2_500,
    ) -> None:
        ids = [model.profile.id for model in models]
        if len(ids) != len(set(ids)):
            raise ValueError("model ids must be unique")
        self._models = list(models)
        self._by_id = {model.profile.id: model for model in models}
        self._clock = clock
        self._burst_requests = burst_requests
        self._burst_tokens = burst_tokens
        self._active: dict[str, str] = {}
        self._benched: dict[str, set[str]] = {}
        self._cooldowns: dict[str, datetime] = {}
        self._disabled: dict[str, str] = {}
        self._lock = RLock()

    def models(self) -> list[ChatModel]:
        return list(self._models)

    def _known(self, model_id: str) -> None:
        if model_id not in self._by_id:
            raise KeyError(model_id)

    def _state(self, session_id: str, model_id: str, now: datetime) -> ModelState:
        if model_id in self._disabled:
            return ModelState.DISABLED
        if model_id in self._benched.get(session_id, set()):
            return ModelState.BENCHED
        until = self._cooldowns.get(model_id)
        if until is not None:
            if until > now:
                return ModelState.COOLING
            self._cooldowns.pop(model_id, None)
        return ModelState.READY

    def candidates(self, session_id: str) -> list[ChatModel]:
        with self._lock:
            if not self._models:
                return []
            active = self._active.get(session_id)
            start = 0
            if active in self._by_id:
                start = next(i for i, model in enumerate(self._models) if model.profile.id == active)
            ordered = self._models[start:] + self._models[:start]
            now = self._clock()
            return [
                model
                for model in ordered
                if self._state(session_id, model.profile.id, now) == ModelState.READY
            ]

    def active(self, session_id: str) -> str | None:
        with self._lock:
            return self._active.get(session_id)

    def set_active(self, session_id: str, model_id: str) -> None:
        with self._lock:
            self._known(model_id)
            self._benched.setdefault(session_id, set()).discard(model_id)
            self._active[session_id] = model_id

    def bench(self, session_id: str, model_id: str) -> None:
        with self._lock:
            self._known(model_id)
            self._benched.setdefault(session_id, set()).add(model_id)

    def cool_down(self, model_id: str, seconds: float) -> None:
        with self._lock:
            self._known(model_id)
            until = self._clock() + timedelta(seconds=max(0.0, seconds))
            current = self._cooldowns.get(model_id)
            if current is None or until > current:
                self._cooldowns[model_id] = until

    def disable(self, model_id: str, detail: str) -> None:
        with self._lock:
            self._known(model_id)
            self._disabled[model_id] = detail
            self._cooldowns.pop(model_id, None)

    def status(self, session_id: str) -> list[ModelStatus]:
        with self._lock:
            now = self._clock()
            active = self._active.get(session_id)
            statuses: list[ModelStatus] = []
            for model in self._models:
                model_id = model.profile.id
                state = self._state(session_id, model_id, now)
                statuses.append(
                    ModelStatus(
                        model_id=model_id,
                        label=model.profile.label,
                        provider=model.profile.provider,
                        state=state,
                        cooldown_until=self._cooldowns.get(model_id) if state == ModelState.COOLING else None,
                        is_active=model_id == active,
                        burstable=model.profile.burstable,
                        detail=self._disabled.get(model_id),
                    )
                )
            return statuses

    def burst(self, model_id: str) -> BurstResult:
        with self._lock:
            self._known(model_id)
            model = self._by_id[model_id]
            if not model.profile.burstable:
                raise ValueError(f"{model_id} does not support rate-limit bursts")

        # A long repeated prompt consumes TPM predictably while avoiding user data.
        prompt = ("probe " * self._burst_tokens).strip()
        requests = 0
        tokens_sent = 0
        for _ in range(self._burst_requests):
            requests += 1
            tokens_sent += self._burst_tokens
            try:
                model.complete([Message(role="user", content=prompt)], max_tokens=1)
            except RateLimited as error:
                self.cool_down(model_id, error.retry_after)
                return BurstResult(
                    model_id=model_id,
                    requests=requests,
                    tokens_sent=tokens_sent,
                    got_429=True,
                    retry_after=error.retry_after,
                )
            except ModelUnavailable as error:
                if error.reason in ("auth", "bad_request"):
                    self.disable(model_id, error.detail or error.reason)
                else:
                    self.cool_down(model_id, 30.0)
                break
        return BurstResult(
            model_id=model_id,
            requests=requests,
            tokens_sent=tokens_sent,
            got_429=False,
        )
