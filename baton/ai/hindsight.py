"""Hindsight-backed long-term memory owned by a dedicated event-loop thread."""

from __future__ import annotations

import asyncio
import json
import re
import threading
import time
from collections.abc import Awaitable, Callable, Sequence
from concurrent.futures import Future, TimeoutError as FutureTimeout
from datetime import datetime
from typing import Any, TypeVar

from pydantic import ValidationError

from baton.interfaces.types import (
    Alert,
    AlertCode,
    CheckId,
    Item,
    ItemKind,
    L2Snapshot,
    RecallTrace,
    WhyAnswer,
    utcnow,
)

T = TypeVar("T")

_MISSION = (
    "Track the working state of a software project across AI models and teammates: "
    "goals, decisions, constraints, rejected approaches with reasons, next steps, "
    "and how each model behaves against the user's preferences."
)
_OBSERVATIONS_MISSION = (
    "Form beliefs about how AI models follow user preferences and about the "
    "project's settled decisions and rejected approaches."
)
_DIRECTIVES = {
    "protect-credentials": "Never store or repeat credentials.",
    "honour-rejections": "A rejected approach stays rejected until the user explicitly reverses it.",
    "cite-decisions": "Cite the turn, model and person when stating a decision.",
}

_STATE_TAGS = (
    "kind:goal",
    "kind:decision",
    "kind:constraint",
    "kind:preference",
    "kind:next_step",
    "kind:open_question",
    "kind:resolved",
    "kind:retraction",
)
_LEDGER_TAGS = ("kind:rejection", "kind:reversal")


def _bank_id(project: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", project.casefold()).strip("-") or "project"
    return f"baton-{slug[:40]}"


def _error_status(error: BaseException) -> int | None:
    for name in ("status", "status_code"):
        value = getattr(error, name, None)
        if isinstance(value, int):
            return value
    response = getattr(error, "response", None)
    value = getattr(response, "status_code", None)
    return value if isinstance(value, int) else None


def _memory_alert(error: BaseException, *, timeout: bool = False) -> Alert:
    if _error_status(error) == 402:
        return Alert(
            level="red",
            code=AlertCode.LTM_NO_CREDITS,
            message="Long-term memory has no remaining credits; using local memory only.",
        )
    message = "Long-term memory timed out; using local memory only." if timeout else (
        "Long-term memory is unavailable; using local memory only."
    )
    return Alert(level="amber", code=AlertCode.LTM_UNAVAILABLE, message=message)


class MemoryService:
    """Own an asyncio loop and Hindsight client on one daemon thread."""

    def __init__(self, client_factory: Callable[[], Any]) -> None:
        self._client_factory = client_factory
        self._loop: asyncio.AbstractEventLoop | None = None
        self._client: Any | None = None
        self._startup_error: BaseException | None = None
        self._ready = threading.Event()
        self._thread = threading.Thread(target=self._run, name="baton-hindsight", daemon=True)
        self._thread.start()
        if not self._ready.wait(10.0):
            raise RuntimeError("Hindsight memory thread did not start")
        if self._startup_error is not None:
            raise RuntimeError("Hindsight client could not be created") from self._startup_error

    def _run(self) -> None:
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            self._loop = loop
            self._client = self._client_factory()
        except Exception as error:
            self._startup_error = error
            self._ready.set()
            return
        self._ready.set()
        loop.run_forever()
        close = getattr(self._client, "aclose", None)
        if close is not None:
            loop.run_until_complete(close())
        loop.close()

    async def _invoke(self, operation: Callable[[Any], Awaitable[T]]) -> T:
        return await operation(self._client)

    def submit(self, operation: Callable[[Any], Awaitable[T]], timeout: float) -> T:
        if self._loop is None:
            raise RuntimeError("Hindsight memory loop is unavailable")
        future = asyncio.run_coroutine_threadsafe(self._invoke(operation), self._loop)
        try:
            return future.result(timeout=max(0.01, timeout))
        except FutureTimeout:
            future.cancel()
            # Let the loop deliver cancellation through nested gather/tasks before
            # the caller is allowed to tear the service down.
            barrier = asyncio.run_coroutine_threadsafe(asyncio.sleep(0), self._loop)
            try:
                barrier.result(timeout=1.0)
            except Exception:
                pass
            raise

    @staticmethod
    def _consume(future: Future[Any]) -> None:
        try:
            future.result()
        except Exception:
            # Retains are intentionally fire-and-forget. Failed documents remain in
            # SQLite and can be submitted again by the backend.
            return

    def fire(self, operation: Callable[[Any], Awaitable[Any]]) -> None:
        if self._loop is None:
            return
        future = asyncio.run_coroutine_threadsafe(self._invoke(operation), self._loop)
        future.add_done_callback(self._consume)

    def close(self) -> None:
        if self._loop is not None and self._loop.is_running():
            async def cancel_pending() -> None:
                current = asyncio.current_task()
                pending = [task for task in asyncio.all_tasks() if task is not current]
                for task in pending:
                    task.cancel()
                if pending:
                    await asyncio.gather(*pending, return_exceptions=True)

            cleanup = asyncio.run_coroutine_threadsafe(cancel_pending(), self._loop)
            try:
                cleanup.result(timeout=1.0)
            except Exception:
                pass
            self._loop.call_soon_threadsafe(self._loop.stop)
            self._thread.join(timeout=2.0)


def _metadata(item: Item) -> dict[str, str]:
    return {
        "item_id": item.id,
        "kind": item.kind.value,
        "text": item.text,
        "reason": item.reason or "",
        "aliases": json.dumps(item.aliases),
        "check_id": item.check_id.value if item.check_id else "",
        "supersedes": item.supersedes or "",
        "session": item.session_id,
        "project": item.project,
        "user": item.user,
        "turn": str(item.turn),
        "model": item.model or "",
        "source": item.source,
        "created_at": item.created_at.isoformat(),
    }


def _content(item: Item) -> str:
    content = f"[{item.kind.value.upper()}] {item.text}"
    if item.reason:
        content += f" Reason: {item.reason}."
    if item.aliases:
        content += f" Also covers: {', '.join(item.aliases)}."
    return content


def _item_from_metadata(metadata: dict[str, str]) -> Item | None:
    try:
        aliases_value = json.loads(metadata.get("aliases", "[]"))
        aliases = tuple(str(value) for value in aliases_value) if isinstance(aliases_value, list) else ()
        check_value = metadata.get("check_id") or None
        return Item(
            id=metadata["item_id"],
            kind=ItemKind(metadata["kind"]),
            text=metadata["text"],
            reason=metadata.get("reason") or None,
            aliases=aliases,
            check_id=CheckId(check_value) if check_value else None,
            supersedes=metadata.get("supersedes") or None,
            session_id=metadata["session"],
            project=metadata["project"],
            user=metadata["user"],
            turn=int(metadata["turn"]),
            model=metadata.get("model") or None,
            source=metadata.get("source", "extractor"),
            created_at=datetime.fromisoformat(metadata["created_at"]),
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError, ValidationError):
        return None


class HindsightLongTermMemory:
    """Long-term memory implementation with deterministic metadata round-tripping."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        *,
        client_factory: Callable[[], Any] | None = None,
    ) -> None:
        if client_factory is None:
            def client_factory() -> Any:
                from hindsight_client import Hindsight

                return Hindsight(
                    base_url=base_url,
                    api_key=api_key,
                    timeout=30.0,
                    max_attempts=1,
                )
        self._service = MemoryService(client_factory)
        self._ensured: set[str] = set()
        self._ensure_lock = threading.Lock()

    async def _ensure(self, client: Any, project: str) -> None:
        bank = _bank_id(project)
        await client.acreate_bank(
            bank_id=bank,
            name=f"Baton: {project}",
            mission=_MISSION,
            disposition={"skepticism": 4, "literalism": 4, "empathy": 2},
            retain_extraction_mode="verbatim",
            enable_observations=True,
            observations_mission=_OBSERVATIONS_MISSION,
        )
        if hasattr(client, "alist_directives") and hasattr(client, "acreate_directive"):
            existing_response = await client.alist_directives(bank)
            existing_values = getattr(
                existing_response,
                "items",
                getattr(existing_response, "directives", existing_response),
            )
            existing = {
                getattr(value, "name", None) if not isinstance(value, dict) else value.get("name")
                for value in (existing_values or [])
            }
            for name, content in _DIRECTIVES.items():
                if name not in existing:
                    await client.acreate_directive(bank, name=name, content=content)

    def ensure_bank(self, project: str) -> list[Alert]:
        bank = _bank_id(project)
        with self._ensure_lock:
            if bank in self._ensured:
                return []
            try:
                self._service.submit(lambda client: self._ensure(client, project), 10.0)
            except FutureTimeout as error:
                return [_memory_alert(error, timeout=True)]
            except Exception as error:
                return [_memory_alert(error)]
            self._ensured.add(bank)
            return []

    def retain(self, project: str, document_id: str, items: Sequence[Item]) -> None:
        if not items:
            return

        async def operation(client: Any) -> None:
            bank = _bank_id(project)
            if bank not in self._ensured:
                await self._ensure(client, project)
                with self._ensure_lock:
                    self._ensured.add(bank)
            batch = [
                {
                    "content": _content(item),
                    "context": item.kind.value,
                    "timestamp": item.created_at,
                    "tags": [f"kind:{item.kind.value}"],
                    "metadata": _metadata(item),
                }
                for item in items
            ]
            await client.aretain_batch(
                bank_id=bank,
                items=batch,
                document_id=document_id,
                # Hindsight rejects async batches whose items share a document id.
                # This call already runs off the request path on MemoryService's
                # thread, so server-side synchronous processing does not add UI latency.
                retain_async=False,
            )

        self._service.fire(operation)

    async def _recall(
        self,
        client: Any,
        *,
        bank: str,
        purpose: str,
        query: str,
        tags: tuple[str, ...],
        max_tokens: int,
    ) -> tuple[list[Any], RecallTrace]:
        started = time.perf_counter()
        response = await client.arecall(
            bank_id=bank,
            query=query,
            types=["world", "experience", "observation"],
            max_tokens=max_tokens,
            budget="mid",
            tags=list(tags),
            tags_match="any_strict",
        )
        results = list(getattr(response, "results", ()) or ())
        trace = RecallTrace(
            purpose=purpose,
            query=query,
            tags=tags,
            result_count=len(results),
            latency_ms=max(0, round((time.perf_counter() - started) * 1000)),
        )
        return results, trace

    async def _snapshot(self, client: Any, project: str) -> tuple[tuple[Item, ...], tuple[RecallTrace, ...]]:
        bank = _bank_id(project)
        if bank not in self._ensured:
            await self._ensure(client, project)
            with self._ensure_lock:
                self._ensured.add(bank)
        state, ledger = await asyncio.gather(
            self._recall(
                client,
                bank=bank,
                purpose="state",
                query=f"goal, decisions, constraints and next step for {project}",
                tags=_STATE_TAGS,
                max_tokens=1_500,
            ),
            self._recall(
                client,
                bank=bank,
                purpose="ledger",
                query="rejected approaches and reasons",
                tags=_LEDGER_TAGS,
                max_tokens=600,
            ),
        )
        items: dict[str, Item] = {}
        for result in [*state[0], *ledger[0]]:
            metadata = getattr(result, "metadata", None)
            if not isinstance(metadata, dict):
                continue
            item = _item_from_metadata(metadata)
            if item is not None:
                items[item.id] = item
        return tuple(items.values()), (state[1], ledger[1])

    def snapshot(self, project: str, *, timeout: float = 5.0) -> L2Snapshot:
        try:
            items, traces = self._service.submit(
                lambda client: self._snapshot(client, project), timeout
            )
            return L2Snapshot(items=items, traces=traces, fetched_at=utcnow())
        except FutureTimeout as error:
            return L2Snapshot(alerts=(_memory_alert(error, timeout=True),), fetched_at=utcnow())
        except Exception as error:
            return L2Snapshot(alerts=(_memory_alert(error),), fetched_at=utcnow())

    async def _why(self, client: Any, project: str, approach: str) -> WhyAnswer:
        bank = _bank_id(project)
        if bank not in self._ensured:
            await self._ensure(client, project)
            with self._ensure_lock:
                self._ensured.add(bank)
        response = await client.areflect(
            bank_id=bank,
            query=f"Why did the team reject {approach}? Cite the turn, model and person.",
            budget="low",
            tags=[
                "kind:rejection",
                "kind:reversal",
                "kind:decision",
                "kind:constraint",
            ],
            tags_match="any_strict",
            include_facts=True,
        )
        based_on = getattr(response, "based_on", None)
        memories = getattr(based_on, "memories", None) or ()
        sources: list[str] = []
        for memory in memories:
            source = (
                getattr(memory, "document_id", None)
                or getattr(memory, "id", None)
                or getattr(memory, "text", None)
            )
            if source and source not in sources:
                sources.append(str(source))
        return WhyAnswer(
            text=getattr(response, "text", None) or None,
            sources=tuple(sources),
        )

    def why(self, project: str, approach: str) -> WhyAnswer:
        try:
            return self._service.submit(
                lambda client: self._why(client, project, approach),
                20.0,
            )
        except FutureTimeout:
            return WhyAnswer(text=None, error="long-term memory timed out")
        except Exception as error:
            if _error_status(error) == 402:
                return WhyAnswer(text=None, error="long-term memory has no credits")
            return WhyAnswer(text=None, error="long-term memory unavailable")

    def close(self) -> None:
        self._service.close()


class UnavailableLongTermMemory:
    """Visible L1-only fallback used when no Hindsight key is configured."""

    def __init__(
        self,
        message: str = "Hindsight API key is not configured; using local memory only.",
    ) -> None:
        self._alert = Alert(
            level="amber",
            code=AlertCode.LTM_UNAVAILABLE,
            message=message,
        )

    def ensure_bank(self, project: str) -> list[Alert]:
        return [self._alert]

    def retain(self, project: str, document_id: str, items: Sequence[Item]) -> None:
        return None

    def snapshot(self, project: str, *, timeout: float = 5.0) -> L2Snapshot:
        return L2Snapshot(alerts=(self._alert,), fetched_at=utcnow())

    def why(self, project: str, approach: str) -> WhyAnswer:
        return WhyAnswer(text=None, error="long-term memory unavailable")
