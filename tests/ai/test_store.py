from __future__ import annotations

import threading
from datetime import timedelta

import pytest

from baton.ai.store import SQLiteStore
from baton.interfaces.ai import MessageRecord
from baton.interfaces.types import (
    BridgeEvent,
    CheckId,
    CheckResult,
    HandoffEvent,
    Item,
    ItemKind,
    Preferences,
    RecallTrace,
    new_id,
    utcnow,
)


def test_store_round_trips_all_contract_records_across_threads() -> None:
    store = SQLiteStore(":memory:")
    session = store.create_session("Baton", "Rahul", True)
    updated = store.update_session(session.id, memory_on=False, prefs=Preferences(no_bullets=True))
    assert updated.memory_on is False
    assert updated.prefs.no_bullets is True
    assert store.list_projects() == ["Baton"]

    user_id = store.save_message(
        MessageRecord(
            session_id=session.id,
            turn=1,
            role="user",
            attempt="user",
            memory_on=False,
            is_final=True,
            content="No Redis",
            created_at=utcnow(),
        )
    )
    first_id = store.save_message(
        MessageRecord(
            session_id=session.id,
            turn=1,
            role="assistant",
            model="groq:a",
            attempt="first",
            memory_on=False,
            is_final=True,
            content="First",
            created_at=utcnow(),
        )
    )
    repair_id = store.save_message(
        MessageRecord(
            session_id=session.id,
            turn=1,
            role="assistant",
            model="groq:a",
            attempt="repair",
            memory_on=False,
            is_final=False,
            content="Repair",
            created_at=utcnow(),
        )
    )
    store.set_final(session.id, 1, repair_id)
    assert store.next_turn(session.id) == 2
    assert [message.is_final for message in store.messages(session.id)] == [True, False, True]

    checks = [CheckResult(check_id=CheckId.REJECTED, status="pass", evidence="")]
    store.save_verifications(repair_id, checks)
    assert store.verifications(repair_id) == checks

    item = Item(
        id=new_id(),
        kind=ItemKind.REJECTION,
        text="Redis",
        reason="free tier",
        aliases=("redis cache",),
        session_id=session.id,
        project=session.project,
        user=session.user,
        turn=1,
        model="groq:a",
        created_at=utcnow(),
    )
    store.add_items([item])
    assert store.items(session.id) == [item]
    store.replace_turn_items(session.id, 1, [])
    assert store.items(session.id) == []

    event = HandoffEvent(
        from_model="groq:a",
        to_model="gemini:b",
        reason="429",
        retry_after=12,
        memories_recalled=3,
        at=utcnow(),
    )
    store.log_handoff(session.id, 1, event)
    assert store.handoffs(session.id) == [(1, event)]

    old = RecallTrace(purpose="state", query="old", tags=(), result_count=0, latency_ms=1)
    state = RecallTrace(purpose="state", query="state", tags=("kind:goal",), result_count=2, latency_ms=3)
    ledger = RecallTrace(purpose="ledger", query="ledger", tags=("kind:rejection",), result_count=1, latency_ms=4)
    store.save_recall(session.id, 1, old)
    store.save_recall(session.id, 2, state)
    store.save_recall(session.id, 2, ledger)
    assert store.recalls(session.id) == [state, ledger]

    records = []
    thread = threading.Thread(target=lambda: records.append(store.get_session(session.id)))
    thread.start()
    thread.join()
    assert records == [updated]
    assert user_id < first_id < repair_id


def test_unknown_ids_raise_key_error() -> None:
    store = SQLiteStore(":memory:")
    try:
        store.get_session("missing")
    except KeyError as error:
        assert error.args == ("missing",)
    else:
        raise AssertionError("expected KeyError")


def test_project_items_and_bridge_events_span_sessions() -> None:
    store = SQLiteStore(":memory:")
    first = store.create_session("Baton", "Rahul", True)
    second = store.create_session("Baton", "Maya", True)
    other = store.create_session("Other", "Rahul", True)
    now = utcnow()

    def item(session_id: str, project: str, text: str, offset: int) -> Item:
        return Item(
            id=new_id(),
            kind=ItemKind.DECISION,
            text=text,
            session_id=session_id,
            project=project,
            user="Rahul",
            turn=1,
            created_at=now + timedelta(seconds=offset),
        )

    later = item(second.id, second.project, "Second decision", 2)
    earlier = item(first.id, first.project, "First decision", 1)
    store.add_items([later, earlier, item(other.id, other.project, "Ignore", 0)])
    assert store.project_items("Baton") == [earlier, later]

    pulled = BridgeEvent(
        at=now,
        project="Baton",
        app="chatgpt",
        action="pull",
        summary="Pulled the baton",
        items=2,
    )
    checked = BridgeEvent(
        at=now + timedelta(seconds=1),
        project="Baton",
        app="claude",
        action="check",
        summary="Checked the response",
        items=1,
        passed=True,
    )
    store.log_bridge_event(pulled)
    store.log_bridge_event(checked)
    assert store.bridge_events("Baton") == [checked, pulled]
    assert store.bridge_events("Baton", limit=1) == [checked]
    with pytest.raises(ValueError, match="non-negative"):
        store.bridge_events("Baton", limit=-1)


def test_patch_stats_upsert_and_model_filter() -> None:
    store = SQLiteStore(":memory:")
    store.record_check("groq:a", CheckId.NO_BULLETS, 1, True)
    store.record_check("groq:a", CheckId.NO_BULLETS, 1, False)
    store.record_check("groq:a", CheckId.NO_BULLETS, 1, True)
    store.record_check("gemini:b", CheckId.NO_EMOJIS, 0, False)

    groq = store.patch_stats("groq:a")
    assert len(groq) == 1
    assert groq[0].passes == 2
    assert groq[0].trials == 3
    assert [stat.model for stat in store.patch_stats()] == ["gemini:b", "groq:a"]
    with pytest.raises(ValueError, match="between 0 and 3"):
        store.record_check("groq:a", CheckId.NO_BULLETS, 4, True)


def test_first_attempt_rates_ignore_repairs_memory_off_and_other_projects() -> None:
    store = SQLiteStore(":memory:")
    session = store.create_session("Baton", "Rahul", True)
    other = store.create_session("Other", "Rahul", True)
    now = utcnow()

    def message(
        session_id: str,
        *,
        turn: int,
        attempt: str,
        memory_on: bool,
        model: str = "groq:a",
    ) -> int:
        return store.save_message(
            MessageRecord(
                session_id=session_id,
                turn=turn,
                role="assistant",
                model=model,
                attempt=attempt,
                memory_on=memory_on,
                is_final=True,
                content="response",
                created_at=now + timedelta(seconds=turn),
            )
        )

    first_id = message(session.id, turn=1, attempt="first", memory_on=True)
    store.save_verifications(
        first_id,
        [
            CheckResult(check_id=CheckId.REJECTED, status="pass", evidence=""),
            CheckResult(check_id=CheckId.NO_BULLETS, status="fail", evidence="bullet"),
            CheckResult(check_id=CheckId.CODE_LANGUAGE, status="n/a", evidence=""),
        ],
    )
    repair_id = message(session.id, turn=1, attempt="repair", memory_on=True)
    store.save_verifications(
        repair_id,
        [CheckResult(check_id=CheckId.REJECTED, status="fail", evidence="repair")],
    )
    off_id = message(session.id, turn=2, attempt="first", memory_on=False)
    store.save_verifications(
        off_id,
        [CheckResult(check_id=CheckId.REJECTED, status="fail", evidence="off")],
    )
    other_id = message(other.id, turn=1, attempt="first", memory_on=True)
    store.save_verifications(
        other_id,
        [CheckResult(check_id=CheckId.REJECTED, status="fail", evidence="other")],
    )

    rates = store.first_attempt_rates("Baton")
    assert len(rates) == 1
    model, session_id, at, checks, failures = rates[0]
    assert (model, session_id, at, checks, failures) == (
        "groq:a",
        session.id,
        now + timedelta(seconds=1),
        2,
        1,
    )
