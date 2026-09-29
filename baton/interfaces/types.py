"""Shared data types used across the AI, backend and frontend boundaries.

Owned by main. A change here is one commit on main, and every sector rebases.
All models are frozen Pydantic models; every datetime is timezone-aware UTC.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict

CONTRACT_VERSION = "2h-2.0"


class Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


BridgeApp = Literal["chatgpt", "claude", "baton"]


class BridgeEvent(Frozen):
    at: datetime
    project: str
    app: BridgeApp
    action: Literal["pull", "record", "check", "import"]
    summary: str
    items: int = 0
    passed: bool | None = None


class BridgeActivity(Frozen):
    app: Literal["chatgpt", "claude"]
    last_seen: datetime | None = None
    pulls: int = 0
    records: int = 0
    checks: int = 0


def new_id() -> str:
    """A fresh item id (uuid4 hex)."""
    return uuid4().hex


def utcnow() -> datetime:
    """The current time, timezone-aware UTC."""
    return datetime.now(timezone.utc)


def turn_document_id(session_id: str, turn: int) -> str:
    """Hindsight document id for one turn's items; retaining it again replaces it."""
    return f"{session_id}:{turn}"


class ItemKind(StrEnum):
    GOAL = "goal"
    DECISION = "decision"
    CONSTRAINT = "constraint"
    REJECTION = "rejection"
    REVERSAL = "reversal"
    PREFERENCE = "preference"
    NEXT_STEP = "next_step"
    OPEN_QUESTION = "open_question"
    RESOLVED = "resolved"
    RETRACTION = "retraction"


class CheckId(StrEnum):
    REJECTED = "rejected"
    CONTINUITY = "continuity"
    NO_BULLETS = "no_bullets"


class Item(Frozen):
    """One append-only fact about the task. The contract is computed from items."""

    id: str
    kind: ItemKind
    text: str
    reason: str | None = None
    aliases: tuple[str, ...] = ()
    check_id: CheckId | None = None
    supersedes: str | None = None  # id of the item this one overrides
    session_id: str
    project: str
    user: str
    turn: int
    model: str | None = None  # None for user edits
    source: Literal["extractor", "user_edit", "system"] = "extractor"
    created_at: datetime


class Preferences(Frozen):
    no_bullets: bool = False
    free_text: tuple[str, ...] = ()  # stated in chat but not verifiable


class Message(Frozen):
    role: Literal["system", "user", "assistant"]
    content: str


class Completion(Frozen):
    text: str  # reasoning (<think> blocks) already stripped
    model_id: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    latency_ms: int


class CheckResult(Frozen):
    check_id: CheckId
    status: Literal["pass", "fail", "n/a"]
    evidence: str = ""


class AlertCode(StrEnum):
    REPAIR_SKIPPED = "repair_skipped"
    EXTRACTION_FAILED = "extraction_failed"
    REVERSAL_UNMATCHED = "reversal_unmatched"
    LTM_UNAVAILABLE = "ltm_unavailable"
    LTM_NO_CREDITS = "ltm_no_credits"
    EMPTY_CONTRACT = "empty_contract"
    MODEL_UNAVAILABLE = "model_unavailable"
    NO_MODEL = "no_model"


class Alert(Frozen):
    level: Literal["info", "amber", "red"]
    code: AlertCode
    message: str


class HandoffEvent(Frozen):
    from_model: str
    to_model: str | None  # None when no model was available
    reason: Literal["429", "manual", "auth", "bad_request", "error"]
    retry_after: float | None = None
    memories_recalled: int = 0
    at: datetime


class RecallTrace(Frozen):
    purpose: Literal["state", "ledger"]
    query: str
    tags: tuple[str, ...]
    result_count: int
    latency_ms: int
    error: str | None = None


class L2Snapshot(Frozen):
    """What long-term memory (Hindsight) returned for a project."""

    items: tuple[Item, ...] = ()
    traces: tuple[RecallTrace, ...] = ()
    alerts: tuple[Alert, ...] = ()
    fetched_at: datetime


class ExtractedItem(Frozen):
    """Extractor output for one fact, before the backend gives it an id and metadata."""

    kind: Literal[
        "goal", "decision", "constraint", "rejection", "reversal",
        "preference", "next_step", "open_question", "resolved",
    ]
    text: str
    reason: str | None = None
    aliases: tuple[str, ...] = ()
    check_id: CheckId | None = None  # set for preferences that map to a check
    target: str | None = None  # reversal/resolved: the approach or question it refers to


class ExtractResult(Frozen):
    items: tuple[ExtractedItem, ...] = ()
    extractor_model: str | None = None
    alerts: tuple[Alert, ...] = ()
