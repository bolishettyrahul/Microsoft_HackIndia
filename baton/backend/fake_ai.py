"""Deterministic, network-free AIServices used by fake mode and backend tests."""

from __future__ import annotations

from collections import defaultdict, deque
from threading import RLock

from baton.interfaces.ai import (
    AIServices,
    BurstResult,
    MessageRecord,
    ModelProfile,
    ModelState,
    ModelStatus,
    SessionRecord,
)
from baton.interfaces.types import BridgeActivity, ExtractResult, L2Snapshot, utcnow


class FakeModel:
    def __init__(self, model_id: str, *replies, default_reply: str | None = None) -> None:
        provider = "gemini" if model_id.startswith("gemini:") else "groq"
        self._profile = ModelProfile(
            id=model_id,
            label=model_id.split(":", 1)[-1],
            provider=provider,
            model=model_id.split(":", 1)[-1],
            base_url="https://example.invalid",
            burstable=provider == "groq",
        )
        self.replies = deque(replies)
        self.default_reply = default_reply or "I will continue from the recorded Baton next step."
        self.calls = []

    @property
    def profile(self):
        return self._profile

    def complete(self, messages, *, max_tokens=None, json_schema=None):
        from baton.interfaces.types import Completion

        self.calls.append(messages)
        value = self.replies.popleft() if self.replies else self.default_reply
        if isinstance(value, Exception):
            raise value
        return Completion(text=value, model_id=self.profile.id, latency_ms=1)


class FakeChain:
    def __init__(self, *models) -> None:
        self._models = list(models)
        self._active = {}
        self._benched = defaultdict(set)
        self._disabled: dict[str, str] = {}
        self._cooling = set()

    def models(self):
        return self._models

    def candidates(self, session_id):
        values = [
            model for model in self._models
            if model.profile.id not in self._benched[session_id]
            and model.profile.id not in self._disabled
            and model.profile.id not in self._cooling
        ]
        active = self._active.get(session_id)
        if active:
            values.sort(key=lambda value: value.profile.id != active)
        return values

    def active(self, session_id):
        return self._active.get(session_id)

    def set_active(self, session_id, model_id):
        if model_id not in {model.profile.id for model in self._models}:
            raise KeyError(model_id)
        self._benched[session_id].discard(model_id)
        self._active[session_id] = model_id

    def bench(self, session_id, model_id):
        self._benched[session_id].add(model_id)

    def cool_down(self, model_id, seconds):
        self._cooling.add(model_id)

    def disable(self, model_id, detail):
        self._disabled[model_id] = detail
        self._cooling.discard(model_id)

    def status(self, session_id):
        result = []
        for model in self._models:
            if model.profile.id in self._disabled:
                state = ModelState.DISABLED
            elif model.profile.id in self._benched[session_id]:
                state = ModelState.BENCHED
            elif model.profile.id in self._cooling:
                state = ModelState.COOLING
            else:
                state = ModelState.READY
            result.append(ModelStatus(
                model_id=model.profile.id,
                label=model.profile.label,
                provider=model.profile.provider,
                state=state,
                is_active=self._active.get(session_id) == model.profile.id,
                burstable=model.profile.burstable,
                detail=self._disabled.get(model.profile.id),
            ))
        return result

    def burst(self, model_id):
        try:
            model = next(value for value in self._models if value.profile.id == model_id)
        except StopIteration as exc:
            raise KeyError(model_id) from exc
        if not model.profile.burstable:
            raise ValueError("not burstable")
        self.cool_down(model_id, 60)
        return BurstResult(
            model_id=model_id,
            requests=2,
            tokens_sent=100,
            got_429=True,
            retry_after=60,
        )


class FakeExtractor:
    def __init__(self, *results) -> None:
        self.results = deque(results)
        self.calls = []

    def extract(self, **kwargs):
        self.calls.append(kwargs)
        return self.results.popleft() if self.results else ExtractResult()


class FakeStore:
    def __init__(self) -> None:
        self.sessions = {}
        self.msgs = defaultdict(list)
        self.item_values = defaultdict(list)
        self.checks = defaultdict(list)
        self.handoff_values = defaultdict(list)
        self.recall_values = defaultdict(list)
        self._message_id = 0
        self._bridge_sessions = {}
        self._bridge_turns = defaultdict(int)
        self._bridge_events = []
        self._bridge_lock = RLock()

    def create_session(self, project, user, memory_on):
        sid = f"session-{len(self.sessions) + 1}"
        value = SessionRecord(
            id=sid,
            project=project,
            user=user,
            memory_on=memory_on,
            created_at=utcnow(),
        )
        self.sessions[sid] = value
        return value

    def get_session(self, session_id):
        if session_id not in self.sessions:
            raise KeyError(session_id)
        return self.sessions[session_id]

    def update_session(self, session_id, *, memory_on=None, prefs=None):
        value = self.get_session(session_id)
        changes = {}
        if memory_on is not None:
            changes["memory_on"] = memory_on
        if prefs is not None:
            changes["prefs"] = prefs
        value = value.model_copy(update=changes)
        self.sessions[session_id] = value
        return value

    def list_projects(self):
        return sorted({value.project for value in self.sessions.values()})

    def next_turn(self, session_id):
        self.get_session(session_id)
        values = [value.turn for value in self.msgs[session_id] if value.attempt == "user"]
        return max(values, default=0) + 1

    def save_message(self, msg: MessageRecord):
        self._message_id += 1
        self.msgs[msg.session_id].append(msg.model_copy(update={"id": self._message_id}))
        return self._message_id

    def set_final(self, session_id, turn, message_id):
        self.msgs[session_id] = [
            value.model_copy(update={"is_final": value.id == message_id})
            if value.turn == turn and value.attempt != "user" else value
            for value in self.msgs[session_id]
        ]

    def messages(self, session_id):
        self.get_session(session_id)
        return list(self.msgs[session_id])

    def save_verifications(self, message_id, results):
        self.checks[message_id] = list(results)

    def verifications(self, message_id):
        return list(self.checks[message_id])

    def add_items(self, items):
        for item in items:
            self.item_values[item.session_id].append(item)

    def replace_turn_items(self, session_id, turn, items):
        self.item_values[session_id] = [
            value for value in self.item_values[session_id] if value.turn != turn
        ]
        self.item_values[session_id].extend(items)

    def items(self, session_id):
        self.get_session(session_id)
        return list(self.item_values[session_id])

    def project_items(self, project):
        return sorted((item for values in self.item_values.values() for item in values
                       if item.project == project), key=lambda i: (i.created_at, i.turn, i.id))

    def bridge_session(self, project, app):
        if app not in ("chatgpt", "claude"):
            raise ValueError("Unknown bridge app")
        with self._bridge_lock:
            key = (project, app)
            if key not in self._bridge_sessions:
                user = "ChatGPT" if app == "chatgpt" else "Claude"
                record = next((s for s in self.sessions.values() if s.project == project and s.user == user), None)
                record = record or self.create_session(project, user, True)
                self._bridge_sessions[key] = record.id
                self._bridge_turns[record.id] = max(self.next_turn(record.id) - 1,
                                                   max((i.turn for i in self.items(record.id)), default=0))
            return self.get_session(self._bridge_sessions[key])

    def reserve_bridge_turn(self, session_id):
        with self._bridge_lock:
            if session_id not in self._bridge_sessions.values():
                raise KeyError(session_id)
            self._bridge_turns[session_id] += 1
            return self._bridge_turns[session_id]

    def log_bridge_event(self, event):
        with self._bridge_lock:
            self._bridge_events.append(event)

    def bridge_events(self, project, limit=50):
        with self._bridge_lock:
            events = [e for e in reversed(self._bridge_events) if e.project == project]
            return sorted(events, key=lambda e: e.at, reverse=True)[:max(0, limit)]

    def bridge_activity(self, project):
        with self._bridge_lock:
            result = []
            for app in ("chatgpt", "claude"):
                events = [e for e in self._bridge_events if e.project == project and e.app == app]
                result.append(BridgeActivity(
                    app=app, last_seen=max((e.at for e in events), default=None),
                    pulls=sum(e.action == "pull" for e in events),
                    records=sum(e.action in ("record", "import") for e in events),
                    checks=sum(e.action == "check" for e in events),
                ))
            return result

    def log_handoff(self, session_id, turn, event):
        self.handoff_values[session_id].append((turn, event))

    def handoffs(self, session_id):
        self.get_session(session_id)
        return list(self.handoff_values[session_id])

    def save_recall(self, session_id, turn, trace):
        self.recall_values[session_id].append(trace)

    def recalls(self, session_id):
        self.get_session(session_id)
        return list(self.recall_values[session_id])


class FakeMemory:
    def __init__(self, snapshot=None) -> None:
        self.value = snapshot or L2Snapshot(fetched_at=utcnow())
        self.retained = []

    def ensure_bank(self, project):
        return []

    def retain(self, project, document_id, items):
        self.retained.append((project, document_id, tuple(items)))

    def snapshot(self, project, *, timeout=5.0):
        return self.value


def services(models, *extracts):
    return AIServices(
        chain=FakeChain(*models),
        extractor=FakeExtractor(*extracts),
        store=FakeStore(),
        memory=FakeMemory(),
    )


def build_fake_ai(settings=None) -> AIServices:
    models = (
        FakeModel("groq:fake-primary"),
        FakeModel("gemini:fake-handoff"),
    )
    return services(models)
