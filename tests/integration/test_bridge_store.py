from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from baton.ai.store import SQLiteStore
from baton.interfaces.types import BridgeEvent, Item, ItemKind, new_id, utcnow


def test_sqlite_bridge_sessions_turns_items_and_activity_survive_reopen(tmp_path):
    path = str(tmp_path / "bridge.db")
    store = SQLiteStore(path)
    session = store.bridge_session("demo", "chatgpt")
    other = store.bridge_session("demo", "claude")
    hidden = store.bridge_session("other", "chatgpt")
    for index, s in enumerate((session, other, hidden)):
        store.add_items([Item(id=new_id(), kind=ItemKind.DECISION, text=f"Choice {index}",
                             session_id=s.id, project=s.project, user=s.user, turn=1, created_at=utcnow())])
    for i in range(55):
        store.log_bridge_event(BridgeEvent(
            at=utcnow() + timedelta(seconds=i), project="demo", app="claude", action="check",
            summary=f"Check {i}", passed=i % 2 == 0,
        ))
    reopened = SQLiteStore(path)
    assert reopened.bridge_session("demo", "chatgpt").id == session.id
    assert len(reopened.project_items("demo")) == 2
    assert len(reopened.bridge_events("demo")) == 50
    assert reopened.bridge_events("demo", 1)[0].summary == "Check 54"
    assert reopened.bridge_events("demo", 1)[0].passed is True
    assert reopened.bridge_activity("demo")[0].checks == 55
    assert not reopened.bridge_events("other")
    with ThreadPoolExecutor(max_workers=6) as pool:
        turns = list(pool.map(lambda _: reopened.reserve_bridge_turn(session.id), range(20)))
        ids = list(pool.map(lambda _: reopened.bridge_session("fresh", "claude").id, range(20)))
    assert len(set(turns)) == 20
    assert len(set(ids)) == 1
    assert SQLiteStore(path).reserve_bridge_turn(session.id) == 21
