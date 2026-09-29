from baton.backend.extraction import build_items
from baton.interfaces.types import CheckId, ExtractedItem, ExtractResult, Item, ItemKind, new_id, utcnow
from .fakes import FakeStore


def test_shared_builder_resolves_cross_session_targets_and_preserves_provenance():
    store = FakeStore()
    session = store.create_session("demo", "Claude", True)
    rejection = Item(
        id=new_id(), kind=ItemKind.REJECTION, text="Redis", aliases=("redis cache",),
        session_id="other-session", project="demo", user="ChatGPT", turn=1, created_at=utcnow(),
    )
    question = rejection.model_copy(update={
        "id": new_id(), "kind": ItemKind.OPEN_QUESTION, "text": "Which cache?", "aliases": (),
    })
    result = ExtractResult(items=(
        ExtractedItem(kind="reversal", text="Redis is now allowed", target="redis cache"),
        ExtractedItem(kind="resolved", text="Cache chosen", target="Which cache?"),
        ExtractedItem(kind="preference", text="No bullets", check_id=CheckId.NO_BULLETS),
    ))
    items, prefs, alerts = build_items(
        result, session=session, turn=2, model_id=None, existing=[rejection, question],
    )
    assert [i.supersedes for i in items[:2]] == [rejection.id, question.id]
    assert all(i.user == "Claude" and i.session_id == session.id and i.turn == 2 for i in items)
    assert prefs.no_bullets
    assert not alerts
    assert store.items(session.id) == []  # Construction has no persistence side effects.


def test_shared_builder_redacts_and_filters_unsafe_aliases_and_unmatched_targets():
    session = FakeStore().create_session("demo", "Dev", True)
    result = ExtractResult(items=(
        ExtractedItem(kind="decision", text="Use an in-process cache"),
        ExtractedItem(kind="rejection", text="Redis", reason="ask dev@example.com",
                      aliases=("in-process cache", "redis cache")),
        ExtractedItem(kind="reversal", text="Allow it", target="dev@example.com"),
        ExtractedItem(kind="resolved", text="Unknown question", target="Missing"),
    ))
    items, _prefs, alerts = build_items(
        result, session=session, turn=1, model_id="groq:test", existing=[],
    )
    assert len(items) == 2
    assert "in-process cache" not in items[1].aliases
    assert "redis cache" in items[1].aliases
    assert "dev@example.com" not in str(items)
    assert len(alerts) == 1 and alerts[0].code == "reversal_unmatched"
    assert "dev@example.com" not in alerts[0].message
