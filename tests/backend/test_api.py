from fastapi.testclient import TestClient

from baton.backend.app import create_app
from baton.backend.facade import Baton
from baton.config import Settings
from baton.interfaces.errors import RateLimited
from baton.interfaces.types import CheckId, ExtractedItem, ExtractResult
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
