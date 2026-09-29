from datetime import timedelta

from baton.backend.contract import combine, ledger, render
from baton.backend.redact import redact
from baton.backend.verifier import verify
from baton.interfaces.types import CheckId, Item, ItemKind, Preferences, new_id, utcnow


def item(kind, text, *, supersedes=None, aliases=(), offset=0):
    return Item(
        id=new_id(), kind=kind, text=text, aliases=aliases, supersedes=supersedes,
        session_id="s1", project="demo", user="Dev", turn=offset + 1,
        created_at=utcnow() + timedelta(seconds=offset),
    )


def test_redacts_every_contract_pattern_without_touching_normal_text():
    value = " ".join((
        "gsk_12345678901234567890", "sk-12345678901234567890",
        "AIza12345678901234567890123456789012345",
        "ghp_123456789012345678901234567890123456",
        "AKIA1234567890123456", "eyJabc.def.ghi", "password=hunter2",
        "dev@example.com", "ordinary-text",
    ))
    cleaned = redact(value)
    assert cleaned.count("[REDACTED:") == 8
    assert "ordinary-text" in cleaned


def test_contract_merge_supersedes_rejection_and_renders_active_state():
    rejected = item(ItemKind.REJECTION, "Redis", aliases=("redis cache",))
    reversed_item = item(ItemKind.REVERSAL, "Redis is allowed", supersedes=rejected.id, offset=1)
    goal_old = item(ItemKind.GOAL, "Old goal")
    goal_new = item(ItemKind.GOAL, "New goal", offset=2)
    state = combine(
        [rejected, reversed_item, goal_old, goal_new], [],
        session_id="s1", project="demo", prefs=Preferences(no_bullets=True),
    )
    assert state.goal == goal_new
    assert not state.rejections
    assert "Goal: New goal" in render(state)
    assert "Preference: No bullet lists" in render(state)
    assert ledger([rejected, reversed_item])[0].status == "reversed"


def test_verifier_detects_real_rejection_and_bullets_but_accepts_negation():
    rejected = item(ItemKind.REJECTION, "Redis", aliases=("elasticache",))
    state = combine(
        [rejected], [], session_id="s1", project="demo",
        prefs=Preferences(no_bullets=True),
    )
    failures = verify("Use Redis.\n- Add a client", state, continuity=False)
    by_id = {value.check_id: value for value in failures}
    assert by_id[CheckId.REJECTED].status == "fail"
    assert by_id[CheckId.NO_BULLETS].status == "fail"
    accepted = verify("Avoid Redis and use the in-process cache.", state, continuity=False)
    assert accepted[0].status == "pass"
