from __future__ import annotations

from collections import deque
from types import SimpleNamespace

import httpx
import openai
from fastapi.testclient import TestClient

from baton.ai.chain import RuntimeModelChain
from baton.ai.extractor import StructuredExtractor
from baton.ai.hindsight import UnavailableLongTermMemory
from baton.ai.provider import OpenAICompatModel
from baton.ai.store import SQLiteStore
from baton.backend.app import create_app
from baton.backend.facade import Baton
from baton.config import Settings
from baton.interfaces.ai import AIServices, ModelProfile
from baton.interfaces.types import CheckId, Item, ItemKind, new_id, utcnow


class _ScriptedCompletions:
    def __init__(self, *values) -> None:
        self.values = deque(values)
        self.requests: list[dict] = []

    def create(self, **request):
        self.requests.append(request)
        value = self.values.popleft()
        if isinstance(value, BaseException):
            raise value
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=value))],
            usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5),
        )


def _client(completions: _ScriptedCompletions):
    return SimpleNamespace(chat=SimpleNamespace(completions=completions))


def _profile(model_id: str, provider: str, *, burstable: bool) -> ModelProfile:
    return ModelProfile(
        id=model_id,
        label=model_id.split(":", 1)[-1],
        provider=provider,
        model=model_id.split(":", 1)[-1],
        base_url="https://example.invalid/v1",
        burstable=burstable,
    )


def _rate_limit(seconds: str = "30") -> openai.RateLimitError:
    request = httpx.Request("POST", "https://example.invalid/v1/chat/completions")
    response = httpx.Response(429, request=request, headers={"retry-after": seconds})
    return openai.RateLimitError("rate limited", response=response, body=None)


def test_complete_http_flow_uses_real_ai_classes_and_sqlite(tmp_path):
    groq_calls = _ScriptedCompletions(_rate_limit(), _rate_limit("60"))
    gemini_calls = _ScriptedCompletions(
        "Use Redis.\n- Add the client.",
        "Continue with the in-process TTL cache in prose.",
        "What is the project? Use Redis.",
    )
    extractor_calls = _ScriptedCompletions(
        '{"items":[]}',
        '{"items":[]}',
    )
    groq = OpenAICompatModel(
        _profile("groq:model-a", "groq", burstable=True),
        "test-key",
        client=_client(groq_calls),
    )
    gemini = OpenAICompatModel(
        _profile("gemini:model-b", "gemini", burstable=False),
        "test-key",
        client=_client(gemini_calls),
    )
    extractor_model = OpenAICompatModel(
        _profile("groq:extractor", "groq", burstable=False),
        "test-key",
        client=_client(extractor_calls),
    )
    store = SQLiteStore(str(tmp_path / "baton.db"))
    ai = AIServices(
        chain=RuntimeModelChain((groq, gemini)),
        extractor=StructuredExtractor((extractor_model,)),
        store=store,
        memory=UnavailableLongTermMemory(),
    )
    baton = Baton(Settings(ai="real"), ai)

    with TestClient(create_app(baton)) as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/projects").json() == []

        created = client.post(
            "/api/sessions",
            json={"project": "demo", "user": "Integrator", "memory_on": True},
        )
        assert created.status_code == 200
        sid = created.json()["session_id"]
        assert client.get(f"/api/sessions/{sid}").status_code == 200
        assert client.patch(
            f"/api/sessions/{sid}",
            json={"prefs": {"no_bullets": True, "free_text": []}},
        ).status_code == 200

        store.add_items((
            Item(
                id=new_id(), kind=ItemKind.REJECTION, text="Redis", reason="free tier",
                aliases=("redis cache",), session_id=sid, project="demo", user="Integrator",
                turn=0, created_at=utcnow(),
            ),
            Item(
                id=new_id(), kind=ItemKind.NEXT_STEP, text="Add an in-process TTL cache",
                session_id=sid, project="demo", user="Integrator", turn=0, created_at=utcnow(),
            ),
        ))

        turn = client.post(f"/api/sessions/{sid}/turns", json={"text": "Continue"})
        assert turn.status_code == 200
        body = turn.json()
        assert body["reply"]["model_id"] == "gemini:model-b"
        assert body["reply"]["attempt"] == "repair"
        assert body["handoffs"][0]["reason"] == "429"
        assert any(not chip["passed"] for chip in body["earlier_attempts"][0]["chips"])
        gemini_system = gemini_calls.requests[0]["messages"][0]["content"]
        assert "<baton_contract" in gemini_system
        assert "Rejected: Redis" in gemini_system

        assert len(client.get(f"/api/sessions/{sid}/turns").json()) == 1
        rerun = client.post(f"/api/sessions/{sid}/rerun")
        assert rerun.status_code == 200
        assert rerun.json()["reply"]["memory_on"] is False
        assert any(chip["check_id"] == "continuity" and not chip["passed"]
                   for chip in rerun.json()["reply"]["chips"])
        assert "<baton_contract" not in gemini_calls.requests[2]["messages"][0]["content"]

        assert client.get(f"/api/sessions/{sid}/models").status_code == 200
        assert client.post(
            f"/api/sessions/{sid}/models/use", json={"model_id": "gemini:model-b"}
        ).status_code == 200
        assert client.post(f"/api/sessions/{sid}/models/switch").status_code == 200
        assert client.post(
            "/api/models/burst", json={"model_id": "groq:model-a"}
        ).json()["result"]["got_429"] is True

        contract = client.get(f"/api/sessions/{sid}/contract")
        assert contract.status_code == 200
        ledger = client.get(f"/api/sessions/{sid}/ledger").json()
        assert ledger[0]["status"] == "active"
        assert client.post(
            f"/api/sessions/{sid}/ledger/reverse",
            json={"item_id": ledger[0]["item_id"], "reason": "changed"},
        ).json()[0]["status"] == "reversed"
        assert client.get(f"/api/sessions/{sid}/trace").status_code == 200
        assert client.post(f"/api/sessions/{sid}/memory/refresh").status_code == 200

        assert client.get("/api/sessions/missing").status_code == 404
        assert client.post(
            "/api/models/burst", json={"model_id": "gemini:model-b"}
        ).status_code == 422

    # Reopen the database through a new Store, not just a new in-memory facade.
    restarted_ai = AIServices(
        chain=RuntimeModelChain((groq, gemini)),
        extractor=ai.extractor,
        store=SQLiteStore(str(tmp_path / "baton.db")),
        memory=UnavailableLongTermMemory(),
    )
    with TestClient(create_app(Baton(Settings(ai="real"), restarted_ai))) as restarted:
        restored = restarted.get(f"/api/sessions/{sid}/turns").json()[0]
        for key in ("reply", "earlier_attempts", "handoffs", "user_text", "can_rerun", "rerun_memory_on"):
            assert restored[key] == rerun.json()[key]
        assert restarted.get(f"/api/sessions/{sid}/ledger").json()[0]["status"] == "reversed"
