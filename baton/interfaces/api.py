"""The backend -> frontend handoff contract: the HTTP API and its JSON views.

The backend serves these from `baton/backend/app.py` (FastAPI, `app`), under `/api`.
The frontend mirrors them in `web/src/api/contract.ts`. Keep the two in step, on main.

Endpoints (all JSON; model ids go in bodies because they contain '/' and ':'):

  GET    /api/health                                   -> Health
  GET    /api/projects                                 -> list[str]
  POST   /api/sessions               StartSession      -> SessionView
  GET    /api/sessions/{sid}                           -> SessionView
  PATCH  /api/sessions/{sid}         UpdateSession     -> SessionView
  GET    /api/sessions/{sid}/turns                     -> list[TurnView]      (transcript)
  POST   /api/sessions/{sid}/turns   SendMessage       -> TurnView            (blocks until final reply)
  POST   /api/sessions/{sid}/rerun                     -> TurnView            (last turn, memory flipped)
  GET    /api/sessions/{sid}/models                    -> list[ModelStatus]
  POST   /api/sessions/{sid}/models/switch             -> list[ModelStatus]   (bench active, manual handoff)
  POST   /api/sessions/{sid}/models/use  UseModel      -> list[ModelStatus]
  POST   /api/models/burst               UseModel      -> BurstView           (real requests until 429)
  GET    /api/sessions/{sid}/contract                  -> ContractView
  GET    /api/sessions/{sid}/ledger                    -> list[LedgerRow]
  POST   /api/sessions/{sid}/ledger/reverse  ReverseRejection -> list[LedgerRow]
  GET    /api/sessions/{sid}/trace                     -> TraceView
  POST   /api/sessions/{sid}/memory/refresh            -> TraceView

Errors: 404 {"detail": ...} for an unknown session or item; 422 for invalid input.
Model, memory and extraction failures never become HTTP errors: they arrive as `alerts`.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from baton.interfaces.ai import BurstResult, ModelStatus
from baton.interfaces.types import (
    Alert,
    CheckId,
    Frozen,
    HandoffEvent,
    Preferences,
    RecallTrace,
)

__all__ = [
    "Health", "StartSession", "UpdateSession", "SendMessage", "UseModel", "ReverseRejection",
    "SessionView", "ChipView", "ReplyView", "TurnView", "ContractLine", "ContractView",
    "LedgerRow", "TraceView", "BurstView", "ModelStatus", "BurstResult",
]

# ---------------------------------------------------------------- request bodies


class StartSession(Frozen):
    project: str
    user: str
    memory_on: bool = True


class UpdateSession(Frozen):
    memory_on: bool | None = None
    prefs: Preferences | None = None


class SendMessage(Frozen):
    text: str


class UseModel(Frozen):
    model_id: str


class ReverseRejection(Frozen):
    item_id: str
    reason: str | None = None


# ---------------------------------------------------------------- views


class Health(Frozen):
    ok: bool
    ai: Literal["real", "fake"]
    models: tuple[str, ...]


class SessionView(Frozen):
    session_id: str
    project: str
    user: str
    memory_on: bool
    prefs: Preferences
    turns: int
    active_model: str | None
    created_at: datetime


class ChipView(Frozen):
    """A check result ready to render (n/a results are dropped)."""

    check_id: CheckId
    passed: bool
    label: str  # e.g. "no-bullets", "rejected: Redis", "continuity"
    evidence: str


class ReplyView(Frozen):
    message_id: int
    model_id: str
    model_label: str
    text: str
    memory_on: bool
    attempt: Literal["first", "repair", "rerun"]
    chips: tuple[ChipView, ...] = ()


class TurnView(Frozen):
    session_id: str
    turn: int
    user_text: str
    reply: ReplyView | None  # None when no model was available
    earlier_attempts: tuple[ReplyView, ...] = ()  # collapsed: repaired first attempt, replaced re-run
    handoffs: tuple[HandoffEvent, ...] = ()
    alerts: tuple[Alert, ...] = ()
    fallback_contract: str | None = None  # the copyable contract when no model answered
    can_rerun: bool = False  # last turn only
    rerun_memory_on: bool | None = None  # the memory setting a re-run would use


class ContractLine(Frozen):
    item_id: str
    text: str
    reason: str | None = None
    turn: int
    model: str | None = None
    user: str
    tier: Literal["l1", "l2"]  # l1 = this session (SQLite), l2 = recalled from Hindsight


class ContractView(Frozen):
    project: str
    goal: ContractLine | None = None
    next_step: ContractLine | None = None
    decisions: tuple[ContractLine, ...] = ()
    constraints: tuple[ContractLine, ...] = ()
    rejections: tuple[ContractLine, ...] = ()  # active only
    open_questions: tuple[ContractLine, ...] = ()
    preferences: Preferences = Preferences()
    rendered: str  # the redacted <baton_contract> block; the "Copy baton" text
    alerts: tuple[Alert, ...] = ()


class LedgerRow(Frozen):
    item_id: str
    approach: str
    reason: str | None = None
    aliases: tuple[str, ...] = ()
    turn: int
    model: str | None = None
    user: str
    status: Literal["active", "reversed"]
    reversal_reason: str | None = None


class TraceView(Frozen):
    traces: tuple[RecallTrace, ...] = ()
    l1_items: tuple[ContractLine, ...] = ()
    l2_items: tuple[ContractLine, ...] = ()
    fetched_at: datetime | None = None
    alerts: tuple[Alert, ...] = ()


class BurstView(Frozen):
    result: BurstResult
    alerts: tuple[Alert, ...] = ()
