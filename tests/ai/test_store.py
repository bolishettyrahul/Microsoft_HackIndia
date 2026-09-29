from __future__ import annotations

import threading

from baton.ai.store import SQLiteStore
from baton.interfaces.ai import MessageRecord
from baton.interfaces.types import (
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
