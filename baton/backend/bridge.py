"""Project-wide contract exchange shared by HTTP import and MCP tools."""
from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
from threading import RLock
from typing import Literal, Sequence

from baton.backend.compose import _RULES
from baton.backend.contract import combine, ledger, line, render
from baton.backend.extraction import build_items
from baton.backend.redact import redact, redact_item
from baton.backend.verifier import verify
from baton.config import Settings
from baton.interfaces.ai import AIServices
from baton.interfaces.api import AppStatus, BridgeView, ContractView
from baton.interfaces.types import BridgeActivity, BridgeEvent, ExtractedItem, ExtractResult, Preferences, utcnow

ExternalApp = Literal["chatgpt", "claude"]


class Bridge:
    def __init__(self, ai: AIServices, settings: Settings) -> None:
        self.ai = ai
        self.settings = settings
        self._locks: dict[str, RLock] = defaultdict(RLock)

    @staticmethod
    def _validate(project: str, app: str | None = None) -> str:
        if not project.strip() or len(project) > 200:
            raise ValueError("Project must contain 1 to 200 characters")
        if app is not None and app not in ("chatgpt", "claude"):
            raise ValueError("Unknown bridge app")
        return project

    def _session(self, project: str, app: ExternalApp):
        self._validate(project, app)
        return self.ai.store.bridge_session(project, app)

    def _state(self, project: str, session_id: str = ""):
        local = [redact_item(i) for i in self.ai.store.project_items(project)]
        snapshot = self.ai.memory.snapshot(project, timeout=self.settings.recall_timeout)
        # Local sessions are authoritative even while L2 is still indexing an edit.
        local_sessions = {i.session_id for i in local} | {session_id}
        recalled = [redact_item(i) for i in snapshot.items
                    if i.project == project and i.session_id not in local_sessions]
        state = combine(local, recalled, session_id=session_id, project=project, prefs=Preferences())
        return state, local, recalled, snapshot

    def _event(self, project, app, action, summary, *, items=0, passed=None):
        self.ai.store.log_bridge_event(BridgeEvent(
            at=utcnow(), project=project, app=app, action=action,
            summary=redact(summary), items=items, passed=passed,
        ))

    def pull(self, project: str, app: ExternalApp) -> str:
        with self._locks[project]:
            session = self._session(project, app)
            state, _local, _recalled, snapshot = self._state(project, session.id)
            self._event(project, app, "pull", f"Pulled the baton ({len(state.tiers)} items)", items=len(state.tiers))
            header = (f"This is the Baton for {project}. Continue from Next step. "
                      "Do not suggest anything listed as Rejected. Before answering, call check_reply with your draft.")
            warnings = "\n".join(f"Memory notice: {a.message}" for a in snapshot.alerts)
            return redact(f"{header}\n\n{render(state)}\n{warnings}").strip()

    def _record(self, project, app, result: ExtractResult, action: str):
        session = self._session(project, app)
        self.ai.memory.ensure_bank(project)
        turn = self.ai.store.reserve_bridge_turn(session.id)
        items, prefs, alerts = build_items(
            result, session=session, turn=turn, model_id=None,
            existing=self.ai.store.project_items(project),
        )
        self.ai.store.add_items(items)
        if prefs != session.prefs:
            self.ai.store.update_session(session.id, prefs=prefs)
        self.ai.memory.retain(project, f"{session.id}:bridge:{turn}", items)
        labels = {"rejection": "Rejected", "next_step": "Next step", "open_question": "Open question"}
        summary = " · ".join(f"{labels.get(i.kind.value, i.kind.value.title())}: {i.text}" for i in items)
        summary = summary or "No items recorded"
        if alerts:
            summary += " · " + " · ".join(a.message for a in alerts)
        self._event(project, app, action, summary, items=len(items))
        state, *_ = self._state(project, session.id)
        next_step = state.next_step.text if state.next_step else "Not recorded yet"
        rejections = "; ".join(i.text for i in state.rejections) or "None"
        text = f"Recorded {len(items)} items.\nNext step: {next_step}\nActive rejections: {rejections}"
        if alerts:
            text += "\n" + "\n".join(a.message for a in alerts)
        return redact(text), tuple(a.model_copy(update={"message": redact(a.message)}) for a in alerts)

    def record_items(self, project: str, app: ExternalApp, items: Sequence[ExtractedItem | dict]) -> str:
        self._validate(project, app)
        if len(items) > 100:
            raise ValueError("Record at most 100 items per call")
        # Validate the entire batch before any writes.
        result = ExtractResult(items=tuple(ExtractedItem.model_validate(i) for i in items))
        if any(not i.text.strip() for i in result.items):
            raise ValueError("Item text must not be empty")
        with self._locks[project]:
            text, _alerts = self._record(project, app, result, "record")
            return text

    def _exchange(self, project, app, user_message, assistant_reply, action):
        self._validate(project, app)
        if not user_message.strip() or not assistant_reply.strip():
            raise ValueError("Both sides of the exchange are required")
        if len(user_message) + len(assistant_reply) > 100_000:
            raise ValueError("Exchange exceeds 100000 characters")
        session = self._session(project, app)
        state, *_ = self._state(project, session.id)
        result = self.ai.extractor.extract(
            user_msg=redact(user_message), reply=redact(assistant_reply), contract_text=redact(render(state)),
        )
        return self._record(project, app, result, action)

    def record_exchange(self, project: str, app: ExternalApp, user_message: str, assistant_reply: str) -> str:
        with self._locks[project]:
            text, _alerts = self._exchange(project, app, user_message, assistant_reply, "record")
            return text

    def import_exchange(self, project: str, app: ExternalApp, user_message: str, assistant_reply: str) -> BridgeView:
        with self._locks[project]:
            _text, alerts = self._exchange(project, app, user_message, assistant_reply, "import")
            view = self.view(project)
            return view.model_copy(update={"contract": view.contract.model_copy(
                update={"alerts": (*view.contract.alerts, *alerts)})})

    def check(self, project: str, app: ExternalApp, draft: str) -> dict:
        with self._locks[project]:
            session = self._session(project, app)
            state, *_ = self._state(project, session.id)
            activity = next((a for a in self.ai.store.bridge_activity(project) if a.app == app), BridgeActivity(app=app))
            failures = [r for r in verify(draft, state, continuity=state.has_context and activity.checks == 0)
                        if r.status == "fail"]
            summary = "Draft passed" if not failures else "Draft failed: " + ", ".join(r.check_id.value for r in failures)
            self._event(project, app, "check", summary, passed=not failures)
            return {"passed": not failures, "failures": [
                {"check_id": r.check_id.value, "evidence": redact(r.evidence), "rule": _RULES[r.check_id]}
                for r in failures
            ]}

    def get_ledger(self, project: str, app: ExternalApp):
        with self._locks[project]:
            session = self._session(project, app)
            _state, local, recalled, _snapshot = self._state(project, session.id)
            rows = ledger((*recalled, *local))
            self._event(project, app, "pull", f"Pulled the rejection ledger ({len(rows)} items)", items=len(rows))
            return rows

    def view(self, project: str) -> BridgeView:
        self._validate(project)
        with self._locks[project]:
            state, local, recalled, snapshot = self._state(project)
            def convert(item):
                return line(item, state.tiers.get(item.id, "l1"))
            contract = ContractView(
                project=project, goal=convert(state.goal) if state.goal else None,
                next_step=convert(state.next_step) if state.next_step else None,
                decisions=tuple(map(convert, state.decisions)), constraints=tuple(map(convert, state.constraints)),
                rejections=tuple(map(convert, state.rejections)), open_questions=tuple(map(convert, state.open_questions)),
                preferences=state.preferences, rendered=redact(render(state)),
                alerts=tuple(a.model_copy(update={"message": redact(a.message)}) for a in snapshot.alerts),
            )
            activity = {a.app: a for a in self.ai.store.bridge_activity(project)}
            now = utcnow()
            apps = []
            for app in ("chatgpt", "claude"):
                a = activity.get(app, BridgeActivity(app=app))
                apps.append(AppStatus(**a.model_dump(), connected=(
                    a.last_seen is not None and now - timedelta(minutes=10) <= a.last_seen <= now)))
            return BridgeView(project=project, apps=tuple(apps),
                              events=tuple(self.ai.store.bridge_events(project)), contract=contract,
                              ledger=ledger((*recalled, *local)))
