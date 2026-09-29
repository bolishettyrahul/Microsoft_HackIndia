from fastapi.testclient import TestClient
import pytest

from baton.backend.app import create_app
from baton.backend.facade import Baton
from baton.backend.wiring import build_baton
from baton.config import Settings
from baton.interfaces.ai import ModelState
from baton.interfaces.errors import ModelUnavailable, RateLimited
from baton.interfaces.types import (
    CheckId,
    ExtractedItem,
    ExtractResult,
    Item,
    ItemKind,
    new_id,
    utcnow,
)
from .fakes import FakeModel, services


def client_for(models, *extracts):
    ai = services(models, *extracts)
    api = Baton(Settings(ai="fake"), ai)
    return TestClient(create_app(api)), ai


def test_full_http_flow_repairs_extracts_contract_and_reverses_ledger():
    extraction = ExtractResult(items=(
        ExtractedItem(kind="goal", text="Build the backend"),
        ExtractedItem(kind="rejection", text="Redis", reason="free tier", aliases=("redis cache",)),
        ExtractedItem(kind="preference", text="No bullet lists", check_id=CheckId.NO_BULLETS),
        ExtractedItem(kind="next_step", text="Create the API routes"),
    ))
    model = FakeModel("groq:model-a", "Initial answer", "Rerun answer")
    client, _ai = client_for([model], extraction, ExtractResult())

    start = client.post("/api/sessions", json={"project": "demo", "user": "Dev"})
    assert start.status_code == 200
    sid = start.json()["session_id"]
    sent = client.post(f"/api/sessions/{sid}/turns", json={"text": "No Redis; build it"})
    assert sent.status_code == 200
    assert sent.json()["reply"]["text"] == "Initial answer"

    contract = client.get(f"/api/sessions/{sid}/contract").json()
    assert contract["goal"]["text"] == "Build the backend"
    assert contract["preferences"]["no_bullets"] is True
    row = client.get(f"/api/sessions/{sid}/ledger").json()[0]
    assert row["status"] == "active"
    reversed_rows = client.post(
        f"/api/sessions/{sid}/ledger/reverse",
        json={"item_id": row["item_id"], "reason": "requirements changed"},
    ).json()
    assert reversed_rows[0]["status"] == "reversed"

    rerun = client.post(f"/api/sessions/{sid}/rerun")
    assert rerun.status_code == 200
    assert rerun.json()["reply"]["attempt"] == "rerun"
    assert rerun.json()["earlier_attempts"]


def test_rate_limit_hands_off_to_next_model_and_records_event():
    first = FakeModel("groq:model-a", RateLimited("groq:model-a", 30))
    second = FakeModel("gemini:model-b", "Continued from the baton")
    client, _ai = client_for([first, second], ExtractResult())
    sid = client.post("/api/sessions", json={"project": "demo", "user": "Dev"}).json()["session_id"]
    response = client.post(f"/api/sessions/{sid}/turns", json={"text": "Continue"})
    body = response.json()
    assert response.status_code == 200
    assert body["reply"]["model_id"] == "gemini:model-b"
    assert body["handoffs"][0]["reason"] == "429"
    assert body["handoffs"][0]["to_model"] == "gemini:model-b"
    assert any(value["code"] == "empty_contract" for value in body["alerts"])


def test_memory_on_repairs_a_failed_preference_once():
    model = FakeModel("groq:model-a", "- First answer", "Repaired prose answer")
    client, _ai = client_for([model], ExtractResult())
    sid = client.post("/api/sessions", json={"project": "demo", "user": "Dev"}).json()["session_id"]
    client.patch(
        f"/api/sessions/{sid}",
        json={"prefs": {"no_bullets": True, "free_text": []}},
    )
    body = client.post(f"/api/sessions/{sid}/turns", json={"text": "Explain it"}).json()
    assert body["reply"]["attempt"] == "repair"
    assert body["reply"]["text"] == "Repaired prose answer"
    assert body["earlier_attempts"][0]["chips"][0]["passed"] is False
    assert len(model.calls) == 2


def test_unknown_session_is_404():
    client, _ai = client_for([FakeModel("groq:model-a", "unused")])
    response = client.get("/api/sessions/missing")
    assert response.status_code == 404


def test_wiring_honours_fake_mode_without_provider_keys():
    api = build_baton(Settings(ai="fake"))
    assert api.health().ai == "fake"
    assert api.health().models


def test_transient_model_error_cools_instead_of_disabling_and_hands_off():
    first = FakeModel(
        "groq:model-a",
        ModelUnavailable("groq:model-a", "error", "temporary 500"),
    )
    second = FakeModel("gemini:model-b", "Fallback response")
    client, _ai = client_for([first, second], ExtractResult())
    sid = client.post("/api/sessions", json={"project": "demo", "user": "Dev"}).json()["session_id"]

    body = client.post(f"/api/sessions/{sid}/turns", json={"text": "Continue"}).json()
    statuses = client.get(f"/api/sessions/{sid}/models").json()

    assert body["reply"]["model_id"] == "gemini:model-b"
    first_status = next(value for value in statuses if value["model_id"] == "groq:model-a")
    assert first_status["state"] == ModelState.COOLING


def test_transcript_is_restored_from_store_after_backend_restart():
    model = FakeModel("groq:model-a", "Persistent response")
    client, ai = client_for([model], ExtractResult())
    sid = client.post("/api/sessions", json={"project": "demo", "user": "Dev"}).json()["session_id"]
    original = client.post(f"/api/sessions/{sid}/turns", json={"text": "Persist me"}).json()

    restarted = Baton(Settings(ai="fake"), ai)
    restored = restarted.turns(sid)

    assert len(restored) == 1
    assert restored[0].user_text == "Persist me"
    assert restored[0].reply is not None
    assert restored[0].reply.text == original["reply"]["text"]
    assert restored[0].reply.message_id == original["reply"]["message_id"]


def test_rerun_keeps_continuity_check_for_models_first_turn():
    model = FakeModel("groq:model-a", "Continue with the endpoint.", "What is the project?")
    client, ai = client_for([model], ExtractResult(), ExtractResult())
    sid = client.post("/api/sessions", json={"project": "demo", "user": "Dev"}).json()["session_id"]
    ai.store.add_items((Item(
        id=new_id(),
        kind=ItemKind.GOAL,
        text="Build a FastAPI cache",
        session_id=sid,
        project="demo",
        user="Dev",
        turn=0,
        created_at=utcnow(),
    ),))
    client.post(f"/api/sessions/{sid}/turns", json={"text": "Continue"})

    rerun = client.post(f"/api/sessions/{sid}/rerun").json()
    continuity = next(
        chip for chip in rerun["reply"]["chips"] if chip["check_id"] == "continuity"
    )
    assert continuity["passed"] is False


@pytest.mark.parametrize("reason,expected", [
    ("auth", "disabled"), ("error", "cooling"), ("bad_request", "ready"),
])
@pytest.mark.parametrize("during_repair", [False, True])
def test_provider_failure_policy_applies_to_initial_and_repair_calls(reason, expected, during_repair):
    error = ModelUnavailable("groq:model-a", reason, "contact dev@example.com")
    replies = ("- Invalid bullet", error) if during_repair else (error,)
    model = FakeModel("groq:model-a", *replies)
    client, _ai = client_for([model, FakeModel("gemini:model-b", "Fallback prose")])
    sid = client.post("/api/sessions", json={"project": "demo", "user": "Dev"}).json()["session_id"]
    client.patch(f"/api/sessions/{sid}", json={"prefs": {"no_bullets": True}})
    response = client.post(f"/api/sessions/{sid}/turns", json={"text": "Continue"})
    assert response.status_code == 200
    body = response.json()
    status = next(s for s in client.get(f"/api/sessions/{sid}/models").json()
                  if s["model_id"] == model.profile.id)
    assert status["state"] == expected
    assert "dev@example.com" not in response.text
    assert "dev@example.com" not in str(status)
    unavailable = next(a for a in body["alerts"] if a["code"] == "model_unavailable")
    assert unavailable["level"] == ("red" if reason == "auth" else "amber")
    if during_repair:
        assert body["reply"]["text"] == "- Invalid bullet"
        assert any(a["code"] == "repair_skipped" for a in body["alerts"])


def test_restart_restores_repaired_and_rerun_attempts_and_handoffs():
    first = FakeModel("groq:model-a", RateLimited("groq:model-a", 30))
    second = FakeModel("gemini:model-b", "- Bullet", "Prose repair", "Rerun prose", "Next turn")
    client, ai = client_for([first, second])
    sid = client.post("/api/sessions", json={"project": "demo", "user": "Dev"}).json()["session_id"]
    client.patch(f"/api/sessions/{sid}", json={"prefs": {"no_bullets": True}})
    client.post(f"/api/sessions/{sid}/turns", json={"text": "Continue"})
    original = client.post(f"/api/sessions/{sid}/rerun").json()
    restored = Baton(Settings(ai="fake"), ai)
    assert restored.turns(sid)[0].model_dump(mode="json") == original
    restored.send(sid, "Next")
    turns = Baton(Settings(ai="fake"), ai).turns(sid)
    assert len(turns) == 2
    assert not turns[0].can_rerun
    assert turns[1].can_rerun
