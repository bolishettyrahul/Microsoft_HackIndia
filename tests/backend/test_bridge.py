from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from baton.backend.app import create_app
from baton.backend.bridge import Bridge
from baton.backend.facade import Baton
from baton.config import Settings
from baton.interfaces.types import BridgeEvent, ExtractResult, ExtractedItem, utcnow
from .fakes import services


def test_cross_app_record_pull_check_reverse_and_project_isolation():
    ai = services([])
    bridge = Bridge(ai, Settings())
    bridge.record_items("demo", "chatgpt", [
        {"kind": "goal", "text": "Build a cache"},
        {"kind": "rejection", "text": "Redis", "reason": "free tier", "aliases": ["redis cache"]},
        {"kind": "next_step", "text": "Build a TTL cache"},
        {"kind": "preference", "text": "No bullets", "check_id": "no_bullets"},
    ])
    assert "Rejected: Redis" in bridge.pull("demo", "claude")
    failed = bridge.check("demo", "claude", "What is the project? Use Redis.\n- Start here")
    assert not failed["passed"]
    assert {f["check_id"] for f in failed["failures"]} == {"continuity", "rejected", "no_bullets"}
    assert all(f["rule"] and f["evidence"] for f in failed["failures"])
    assert bridge.check("demo", "claude", "Continue with the TTL cache.")["passed"]
    bridge.record_items("demo", "claude", [{"kind": "reversal", "text": "Redis allowed", "target": "redis cache"}])
    assert bridge.get_ledger("demo", "chatgpt")[0].status == "reversed"
    assert bridge.view("other").contract.goal is None
    assert not bridge.view("other").events
    assert bridge.view("demo").contract.goal.user == "ChatGPT"
    assert bridge.view("demo").ledger[0].reversal_reason == "Redis allowed"


def test_validation_happens_before_record_and_empty_extracts_get_unique_documents():
    ai = services([])
    bridge = Bridge(ai, Settings())
    with pytest.raises(ValueError):
        bridge.record_items("demo", "chatgpt", [{"kind": "goal", "text": "Valid"}, {"kind": "invalid", "text": "No"}])
    assert not ai.store.project_items("demo") and not ai.store.bridge_events("demo")
    bridge.record_items("demo", "chatgpt", [])
    bridge.record_items("demo", "chatgpt", [])
    assert len({document for _, document, _ in ai.memory.retained}) == 2


def test_http_import_setup_and_validation():
    extraction = ExtractResult(items=(ExtractedItem(kind="rejection", text="Redis", reason="free tier"),))
    ai = services([], extraction)
    api = Baton(Settings(ai="fake", mcp_token="test-token-with-enough-entropy", public_url="https://baton.example"), ai)
    with TestClient(create_app(api)) as client:
        setup = client.get("/api/bridge/setup").json()
        assert setup["chatgpt_url"].startswith("https://baton.example/mcp/chatgpt/")
        assert setup["claude_url"] in setup["claude_desktop_config"]
        response = client.post("/api/projects/demo/import", json={
            "user_message": "No Redis, contact dev@example.com", "assistant_reply": "Use TTL cache",
        })
        assert response.status_code == 200
        view = response.json()
        assert view["events"][0]["action"] == "import"
        assert view["contract"]["rejections"][0]["text"] == "Redis"
        assert "dev@example.com" not in str(ai.extractor.calls)
        assert client.get("/api/projects/demo/bridge").json()["apps"][0]["records"] == 1
        assert client.post("/api/projects/demo/import", json={"app": "unknown", "user_message": "a", "assistant_reply": "b"}).status_code == 422
        assert client.post("/api/projects/demo/import", json={"user_message": "", "assistant_reply": "b"}).status_code == 422


def test_status_and_first_check_use_all_events_not_only_timeline():
    ai = services([])
    bridge = Bridge(ai, Settings())
    bridge.record_items("demo", "chatgpt", [{"kind": "goal", "text": "Build a cache"}])
    bridge.check("demo", "claude", "Continue")
    for _ in range(55):
        bridge.pull("demo", "chatgpt")
    view = bridge.view("demo")
    assert len(view.events) == 50
    assert view.apps[1].connected and view.apps[1].checks == 1
    assert view.apps[0].pulls == 55
    assert bridge.check("demo", "claude", "What is the project?")["passed"]
    ai.store.log_bridge_event(BridgeEvent(
        at=utcnow() - timedelta(minutes=11), project="old", app="claude", action="pull", summary="Old pull",
    ))
    assert not bridge.view("old").apps[1].connected


def test_backend_restart_reuses_external_session_and_keeps_events():
    ai = services([])
    bridge = Bridge(ai, Settings())
    bridge.record_items("demo", "chatgpt", [{"kind": "decision", "text": "A"}])
    restarted = Bridge(ai, Settings())
    restarted.record_items("demo", "chatgpt", [{"kind": "decision", "text": "B"}])
    items = ai.store.project_items("demo")
    assert len({i.session_id for i in items}) == 1
    assert [i.turn for i in items] == [1, 2]
    assert len(restarted.view("demo").events) == 2
