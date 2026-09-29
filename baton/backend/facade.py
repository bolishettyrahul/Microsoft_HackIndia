"""BatonAPI facade: view construction and user actions over AIServices."""

from __future__ import annotations

from collections import defaultdict
from threading import RLock

from baton.backend.contract import combine, ledger, line, render
from baton.backend.bridge import Bridge
from baton.backend.redact import redact
from baton.backend.turn import TurnRunner, _chip, rerun_last_turn, run_turn
from baton.config import Settings
from baton.interfaces.ai import AIServices
from baton.interfaces.api import (
    BurstView,
    ContractView,
    Health,
    ReplyView,
    SessionView,
    TraceView,
    TurnView,
)
from baton.interfaces.types import CheckId, HandoffEvent, Item, ItemKind, L2Snapshot, new_id, utcnow


class Baton:
    """Concrete backend facade consumed by the HTTP routes."""

    def __init__(self, settings: Settings, ai: AIServices) -> None:
        self.settings = settings
        self.ai = ai
        self.bridge = Bridge(ai, settings)
        self._snapshots: dict[str, L2Snapshot] = {}
        self._turns: dict[str, list[TurnView]] = defaultdict(list)
        self._locks: dict[str, RLock] = defaultdict(RLock)
        self.runner = TurnRunner(ai, settings, self._snapshot)

    def _snapshot(self, project: str, refresh: bool) -> L2Snapshot:
        if refresh or project not in self._snapshots:
            self._snapshots[project] = self.ai.memory.snapshot(
                project, timeout=self.settings.recall_timeout
            )
        return self._snapshots[project]

    def health(self) -> Health:
        return Health(
            ok=True,
            ai="fake" if self.settings.ai == "fake" else "real",
            models=tuple(model.profile.id for model in self.ai.chain.models()),
        )

    def projects(self) -> list[str]:
        return self.ai.store.list_projects()

    def start_session(self, project: str, user: str, memory_on: bool = True) -> SessionView:
        self.ai.memory.ensure_bank(project)
        record = self.ai.store.create_session(project, user, memory_on)
        self._snapshot(project, True)
        return self.session(record.id)

    def session(self, session_id: str) -> SessionView:
        record = self.ai.store.get_session(session_id)
        messages = self.ai.store.messages(session_id)
        turns = max((value.turn for value in messages if value.attempt == "user"), default=0)
        return SessionView(
            session_id=record.id,
            project=record.project,
            user=record.user,
            memory_on=record.memory_on,
            prefs=record.prefs,
            turns=turns,
            active_model=self.ai.chain.active(session_id),
            created_at=record.created_at,
        )

    def update_session(self, session_id: str, *, memory_on=None, prefs=None) -> SessionView:
        self.ai.store.update_session(session_id, memory_on=memory_on, prefs=prefs)
        return self.session(session_id)

    def turns(self, session_id: str) -> tuple[TurnView, ...]:
        self.ai.store.get_session(session_id)
        if not self._turns[session_id]:
            self._turns[session_id] = self._restore_turns(session_id)
        return tuple(self._turns[session_id])

    def _restore_turns(self, session_id: str) -> list[TurnView]:
        """Rebuild the transcript views from durable Store records after a restart."""
        records = self.ai.store.messages(session_id)
        by_turn = defaultdict(list)
        for record in records:
            by_turn[record.turn].append(record)
        model_labels = {
            model.profile.id: model.profile.label for model in self.ai.chain.models()
        }
        handoffs = defaultdict(list)
        for turn, event in self.ai.store.handoffs(session_id):
            handoffs[turn].append(event)

        restored: list[TurnView] = []
        last_turn = max(by_turn, default=0)
        for turn in sorted(by_turn):
            values = by_turn[turn]
            users = [value for value in values if value.attempt == "user"]
            assistants = [value for value in values if value.attempt != "user"]

            def reply(record) -> ReplyView:
                results = self.ai.store.verifications(record.id) if record.id is not None else ()
                # Stores need not preserve insertion order; keep live and restored
                # check chips in the same order as the verifier.
                results = sorted(results, key=lambda result: tuple(CheckId).index(result.check_id))
                return ReplyView(
                    message_id=record.id or 0,
                    model_id=record.model or "unknown",
                    model_label=model_labels.get(record.model, record.model or "Unknown model"),
                    text=record.content,
                    memory_on=record.memory_on,
                    attempt=record.attempt,
                    chips=tuple(_chip(result) for result in results if result.status != "n/a"),
                )

            final_record = next((value for value in reversed(assistants) if value.is_final), None)
            final = reply(final_record) if final_record else None
            earlier = tuple(reply(value) for value in assistants if not value.is_final)
            can_rerun = turn == last_turn and final is not None
            restored.append(TurnView(
                session_id=session_id,
                turn=turn,
                user_text=users[-1].content if users else "",
                reply=final,
                earlier_attempts=earlier,
                handoffs=tuple(handoffs[turn]),
                can_rerun=can_rerun,
                rerun_memory_on=not final.memory_on if can_rerun and final else None,
            ))
        return restored

    def send(self, session_id: str, text: str) -> TurnView:
        with self._locks[session_id]:
            self.turns(session_id)
            previous = self._turns[session_id]
            if previous:
                previous[-1] = previous[-1].model_copy(update={"can_rerun": False, "rerun_memory_on": None})
            result = run_turn(self.runner, session_id, text)
            previous.append(result)
            return result

    def rerun(self, session_id: str) -> TurnView:
        with self._locks[session_id]:
            self.turns(session_id)
            if not self._turns[session_id]:
                raise KeyError("No turn to rerun")
            old = self._turns[session_id][-1]
            if old.reply is None:
                raise KeyError("The last turn has no reply")
            result = rerun_last_turn(
                self.runner,
                session_id,
                old.turn,
                old.user_text,
                old.reply.model_id,
                not old.reply.memory_on,
                (*old.earlier_attempts, old.reply),
            )
            self._turns[session_id][-1] = result
            return result

    def models(self, session_id: str):
        self.ai.store.get_session(session_id)
        return self.ai.chain.status(session_id)

    def switch_model(self, session_id: str):
        session = self.ai.store.get_session(session_id)
        current = self.ai.chain.active(session_id)
        if current is None:
            candidates = self.ai.chain.candidates(session_id)
            if candidates:
                self.ai.chain.set_active(session_id, candidates[0].profile.id)
            return self.ai.chain.status(session_id)
        self.ai.chain.bench(session_id, current)
        candidates = self.ai.chain.candidates(session_id)
        target = candidates[0].profile.id if candidates else None
        if target:
            self.ai.chain.set_active(session_id, target)
        snap = self._snapshot(session.project, True)
        event = HandoffEvent(
            from_model=current,
            to_model=target,
            reason="manual",
            memories_recalled=len(snap.items),
            at=utcnow(),
        )
        self.ai.store.log_handoff(session_id, self.ai.store.next_turn(session_id), event)
        return self.ai.chain.status(session_id)

    def use_model(self, session_id: str, model_id: str):
        self.ai.store.get_session(session_id)
        self.ai.chain.set_active(session_id, model_id)
        return self.ai.chain.status(session_id)

    def burst(self, model_id: str) -> BurstView:
        return BurstView(result=self.ai.chain.burst(model_id))

    def _state(self, session_id: str):
        session = self.ai.store.get_session(session_id)
        snapshot = self._snapshot(session.project, False)
        state = combine(
            self.ai.store.items(session_id),
            snapshot.items,
            session_id=session_id,
            project=session.project,
            prefs=session.prefs,
        )
        return session, snapshot, state

    def contract(self, session_id: str) -> ContractView:
        _session, snapshot, state = self._state(session_id)
        tier = lambda item: state.tiers.get(item.id, "l1")
        return ContractView(
            project=state.project,
            goal=line(state.goal, tier(state.goal)) if state.goal else None,
            next_step=line(state.next_step, tier(state.next_step)) if state.next_step else None,
            decisions=tuple(line(value, tier(value)) for value in state.decisions),
            constraints=tuple(line(value, tier(value)) for value in state.constraints),
            rejections=tuple(line(value, tier(value)) for value in state.rejections),
            open_questions=tuple(line(value, tier(value)) for value in state.open_questions),
            preferences=state.preferences,
            rendered=redact(render(state)),
            alerts=snapshot.alerts,
        )

    def ledger(self, session_id: str):
        session, snapshot, _state = self._state(session_id)
        l2 = [value for value in snapshot.items if value.session_id != session_id]
        return ledger((*l2, *self.ai.store.items(session_id)))

    def reverse(self, session_id: str, item_id: str, reason: str | None = None):
        session = self.ai.store.get_session(session_id)
        rows = self.ledger(session_id)
        row = next((value for value in rows if value.item_id == item_id), None)
        if row is None:
            raise KeyError(item_id)
        if row.status == "reversed":
            return rows
        item = Item(
            id=new_id(),
            kind=ItemKind.REVERSAL,
            text=f"Reversed rejection of {row.approach}",
            reason=redact(reason) if reason else None,
            supersedes=item_id,
            session_id=session_id,
            project=session.project,
            user=session.user,
            turn=max(0, self.ai.store.next_turn(session_id) - 1),
            model=None,
            source="user_edit",
            created_at=utcnow(),
        )
        self.ai.store.add_items((item,))
        self.ai.memory.retain(session.project, f"{session_id}:edit:{item.id}", (item,))
        return self.ledger(session_id)

    def trace(self, session_id: str, *, refresh: bool = False) -> TraceView:
        session = self.ai.store.get_session(session_id)
        snapshot = self._snapshot(session.project, refresh)
        l1 = self.ai.store.items(session_id)
        l2 = [value for value in snapshot.items if value.session_id != session_id]
        return TraceView(
            traces=snapshot.traces,
            l1_items=tuple(line(value, "l1") for value in l1),
            l2_items=tuple(line(value, "l2") for value in l2),
            fetched_at=snapshot.fetched_at,
            alerts=snapshot.alerts,
        )
