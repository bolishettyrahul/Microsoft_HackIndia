from __future__ import annotations

import asyncio
import threading
from concurrent.futures import TimeoutError as FutureTimeout
from types import SimpleNamespace

from baton.ai.hindsight import HindsightLongTermMemory, UnavailableLongTermMemory
from baton.interfaces.types import AlertCode, Item, ItemKind, new_id, utcnow


class _Client:
    def __init__(self, item: Item, *, delay: float = 0.0, status: int | None = None) -> None:
        self.item = item
        self.delay = delay
        self.status = status
        self.created = []
        self.retained = []
        self.retain_event = threading.Event()

    async def acreate_bank(self, **kwargs):
        self.created.append(kwargs)

    async def alist_directives(self, bank_id):
        return []

    async def acreate_directive(self, bank_id, name, content):
        return None

    async def aretain_batch(self, **kwargs):
        self.retained.append(kwargs)
        self.retain_event.set()

    async def arecall(self, **kwargs):
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.status is not None:
            error = RuntimeError("memory error")
            error.status = self.status
            raise error
        metadata = {
            "item_id": self.item.id,
            "kind": self.item.kind.value,
            "text": self.item.text,
            "reason": self.item.reason or "",
            "aliases": "[]",
            "check_id": "",
            "supersedes": "",
            "session": self.item.session_id,
            "project": self.item.project,
            "user": self.item.user,
            "turn": str(self.item.turn),
            "model": self.item.model or "",
            "source": self.item.source,
            "created_at": self.item.created_at.isoformat(),
        }
        return SimpleNamespace(results=[SimpleNamespace(metadata=metadata)])

    async def areflect(self, **kwargs):
        self.reflect_kwargs = kwargs
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.status is not None:
            error = RuntimeError("memory error")
            error.status = self.status
            raise error
        return SimpleNamespace(
            text="Redis was rejected because the project must stay on the free tier.",
            based_on=SimpleNamespace(
                memories=[
                    SimpleNamespace(
                        document_id="session:1",
                        id="memory-1",
                        text="Redis was rejected.",
                    ),
                    SimpleNamespace(document_id=None, id="memory-2", text="Use local cache."),
                ]
            ),
        )

    async def aclose(self):
        return None


def _item() -> Item:
    return Item(
        id=new_id(),
        kind=ItemKind.DECISION,
        text="Use SQLite",
        session_id="session",
        project="Baton Demo",
        user="Rahul",
        turn=1,
        model="groq:a",
        created_at=utcnow(),
    )


def test_retain_and_snapshot_round_trip_metadata() -> None:
    item = _item()
    client = _Client(item)
    memory = HindsightLongTermMemory("https://example.test", "key", client_factory=lambda: client)
    try:
        assert memory.ensure_bank(item.project) == []
        memory.retain(item.project, "session:1", [item])
        assert client.retain_event.wait(1)

        snapshot = memory.snapshot(item.project)

        assert snapshot.items == (item,)
        assert [trace.purpose for trace in snapshot.traces] == ["state", "ledger"]
        assert snapshot.alerts == ()
        assert client.retained[0]["document_id"] == "session:1"
        assert client.retained[0]["retain_async"] is False
    finally:
        memory.close()


def test_snapshot_turns_402_into_no_credits_alert() -> None:
    item = _item()
    client = _Client(item, status=402)
    memory = HindsightLongTermMemory("https://example.test", "key", client_factory=lambda: client)
    try:
        snapshot = memory.snapshot(item.project)
        assert snapshot.items == ()
        assert snapshot.alerts[0].code == AlertCode.LTM_NO_CREDITS
    finally:
        memory.close()


def test_snapshot_timeout_never_raises() -> None:
    item = _item()
    client = _Client(item, delay=0.2)
    memory = HindsightLongTermMemory("https://example.test", "key", client_factory=lambda: client)
    try:
        snapshot = memory.snapshot(item.project, timeout=0.01)
        assert snapshot.alerts[0].code == AlertCode.LTM_UNAVAILABLE
    finally:
        memory.close()


def test_why_uses_grounded_reflect_and_returns_sources() -> None:
    item = _item()
    client = _Client(item)
    memory = HindsightLongTermMemory("https://example.test", "key", client_factory=lambda: client)
    try:
        answer = memory.why(item.project, "Redis")

        assert "free tier" in (answer.text or "")
        assert answer.sources == ("session:1", "memory-2")
        assert answer.error is None
        assert client.reflect_kwargs["query"] == (
            "Why did the team reject Redis? Cite the turn, model and person."
        )
        assert client.reflect_kwargs["budget"] == "low"
        assert client.reflect_kwargs["tags_match"] == "any_strict"
        assert client.reflect_kwargs["include_facts"] is True
        assert client.reflect_kwargs["tags"] == [
            "kind:rejection",
            "kind:reversal",
            "kind:decision",
            "kind:constraint",
        ]
    finally:
        memory.close()


def test_why_turns_402_and_timeout_into_visible_errors() -> None:
    item = _item()
    client = _Client(item, status=402)
    memory = HindsightLongTermMemory("https://example.test", "key", client_factory=lambda: client)
    try:
        assert memory.why(item.project, "Redis").error == "long-term memory has no credits"

        original_submit = memory._service.submit

        def timed_out(operation, timeout):
            raise FutureTimeout

        memory._service.submit = timed_out
        assert memory.why(item.project, "Redis").error == "long-term memory timed out"
        memory._service.submit = original_submit
    finally:
        memory.close()


def test_unavailable_memory_why_is_visible() -> None:
    answer = UnavailableLongTermMemory().why("Baton", "Redis")
    assert answer.text is None
    assert answer.sources == ()
    assert answer.error == "long-term memory unavailable"
