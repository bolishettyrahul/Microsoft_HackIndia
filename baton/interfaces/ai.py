"""The AI -> backend handoff contract.

The AI sector implements these protocols in `baton/ai/` and exposes one function,
`baton.ai.build.build_ai(settings) -> AIServices`. The backend uses only what is here.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Literal, Protocol, Sequence

from baton.interfaces.types import (
    CheckResult,
    Completion,
    ExtractResult,
    Frozen,
    HandoffEvent,
    Item,
    L2Snapshot,
    Message,
    Preferences,
    RecallTrace,
    Alert,
    BridgeActivity,
    BridgeEvent,
)

# ---------------------------------------------------------------- models


class ModelProfile(Frozen):
    id: str  # "groq:openai/gpt-oss-120b"
    label: str  # "gpt-oss-120b · Groq"
    provider: Literal["groq", "gemini"]
    model: str  # the provider's own model name
    base_url: str
    burstable: bool  # Groq models only


class ChatModel(Protocol):
    @property
    def profile(self) -> ModelProfile: ...

    def complete(
        self,
        messages: Sequence[Message],
        *,
        max_tokens: int | None = None,
        json_schema: dict | None = None,
    ) -> Completion:
        """One provider call, no retries. Raises only RateLimited or ModelUnavailable."""
        ...


class ModelState(StrEnum):
    READY = "ready"
    COOLING = "cooling"
    BENCHED = "benched"
    DISABLED = "disabled"


class ModelStatus(Frozen):
    model_id: str
    label: str
    provider: str
    state: ModelState
    cooldown_until: datetime | None = None
    is_active: bool
    burstable: bool
    detail: str | None = None


class BurstResult(Frozen):
    model_id: str
    requests: int
    tokens_sent: int
    got_429: bool
    retry_after: float | None = None


class ModelChain(Protocol):
    """Thread-safe. Cooldowns and disables are global; active and bench are per session."""

    def models(self) -> list[ChatModel]: ...

    def candidates(self, session_id: str) -> list[ChatModel]:
        """Active model first, then the rest in chain order, wrapping; skips non-ready models."""
        ...

    def active(self, session_id: str) -> str | None: ...

    def set_active(self, session_id: str, model_id: str) -> None:
        """Sticky until it fails or the user switches. KeyError for an unknown model."""
        ...

    def bench(self, session_id: str, model_id: str) -> None:
        """Manual 'Switch model now': benches the model for this session only."""
        ...

    def cool_down(self, model_id: str, seconds: float) -> None: ...

    def disable(self, model_id: str, detail: str) -> None: ...

    def status(self, session_id: str) -> list[ModelStatus]: ...

    def burst(self, model_id: str) -> BurstResult:
        """Send real padded requests until a 429 (max 6), then cool the model down.
        ValueError if the model is not burstable."""
        ...


class Extractor(Protocol):
    def extract(self, *, user_msg: str, reply: str, contract_text: str) -> ExtractResult:
        """Record only what the USER stated, accepted or rejected.
        Never raises; on failure returns items=() and an EXTRACTION_FAILED alert."""
        ...


# ---------------------------------------------------------------- memory (L1 SQLite, L2 Hindsight)


class SessionRecord(Frozen):
    id: str
    project: str
    user: str
    memory_on: bool
    prefs: Preferences = Preferences()
    created_at: datetime


class MessageRecord(Frozen):
    id: int | None = None  # set by the store
    session_id: str
    turn: int
    role: Literal["user", "assistant"]
    model: str | None = None
    attempt: Literal["user", "first", "repair", "rerun"]
    memory_on: bool
    is_final: bool
    content: str  # already redacted by the backend
    created_at: datetime


class Store(Protocol):
    """L1: SQLite, thread-safe (one connection per thread, WAL). Raises KeyError for unknown ids."""

    def create_session(self, project: str, user: str, memory_on: bool) -> SessionRecord: ...
    def get_session(self, session_id: str) -> SessionRecord: ...
    def update_session(
        self, session_id: str, *, memory_on: bool | None = None, prefs: Preferences | None = None
    ) -> SessionRecord: ...
    def list_projects(self) -> list[str]: ...

    def next_turn(self, session_id: str) -> int: ...
    def save_message(self, msg: MessageRecord) -> int: ...
    def set_final(self, session_id: str, turn: int, message_id: int) -> None:
        """Mark message_id final for that turn and every other assistant message of the turn not final."""
        ...
    def messages(self, session_id: str) -> list[MessageRecord]: ...
    def save_verifications(self, message_id: int, results: Sequence[CheckResult]) -> None: ...
    def verifications(self, message_id: int) -> list[CheckResult]: ...

    def add_items(self, items: Sequence[Item]) -> None: ...
    def replace_turn_items(self, session_id: str, turn: int, items: Sequence[Item]) -> None: ...
    def items(self, session_id: str) -> list[Item]: ...

    def project_items(self, project: str) -> list[Item]: ...
    def bridge_session(self, project: str, app: Literal["chatgpt", "claude"]) -> SessionRecord:
        """Atomically get or create a durable external-app session."""
        ...
    def reserve_bridge_turn(self, session_id: str) -> int:
        """Reserve a unique, increasing turn even when extraction returns no items."""
        ...
    def log_bridge_event(self, event: BridgeEvent) -> None: ...
    def bridge_events(self, project: str, limit: int = 50) -> list[BridgeEvent]: ...
    def bridge_activity(self, project: str) -> list[BridgeActivity]:
        """All-time counts and latest activity, independent of timeline limits."""
        ...

    def log_handoff(self, session_id: str, turn: int, event: HandoffEvent) -> None: ...
    def handoffs(self, session_id: str) -> list[tuple[int, HandoffEvent]]: ...
    def save_recall(self, session_id: str, turn: int, trace: RecallTrace) -> None: ...
    def recalls(self, session_id: str) -> list[RecallTrace]:
        """Traces from the latest recall only."""
        ...


class LongTermMemory(Protocol):
    """L2: Hindsight. Never raises; failures come back as alerts."""

    def ensure_bank(self, project: str) -> list[Alert]: ...

    def retain(self, project: str, document_id: str, items: Sequence[Item]) -> None:
        """Fire-and-forget. Replaces the whole document. Items carry full metadata so
        snapshot() can rebuild them exactly."""
        ...

    def snapshot(self, project: str, *, timeout: float = 5.0) -> L2Snapshot:
        """Recall the project's state and ledger items (rebuilt from metadata, not recalled text).
        Timeout -> LTM_UNAVAILABLE alert; 402 -> LTM_NO_CREDITS alert."""
        ...


# ---------------------------------------------------------------- the bundle


@dataclass(frozen=True)
class AIServices:
    chain: ModelChain
    extractor: Extractor
    store: Store
    memory: LongTermMemory
