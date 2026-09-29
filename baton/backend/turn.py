"""The synchronous turn orchestrator used by the FastAPI facade."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Sequence

from baton.backend.compose import compose, strip_reasoning
from baton.backend.contract import ContractState, combine, render, resolve, validate_aliases
from baton.backend.redact import redact, redact_item
from baton.backend.verifier import verify
from baton.config import Settings
from baton.interfaces.ai import AIServices, ChatModel, MessageRecord, SessionRecord
from baton.interfaces.api import ChipView, ReplyView, TurnView
from baton.interfaces.errors import ModelUnavailable, RateLimited
from baton.interfaces.types import (
    Alert,
    AlertCode,
    CheckId,
    CheckResult,
    HandoffEvent,
    Item,
    ItemKind,
    L2Snapshot,
    Message,
    Preferences,
    new_id,
    turn_document_id,
    utcnow,
)


SnapshotGetter = Callable[[str, bool], L2Snapshot]


def _chip(result: CheckResult) -> ChipView:
    labels = {
        CheckId.REJECTED: "rejected approach",
        CheckId.CONTINUITY: "continuity",
        CheckId.NO_BULLETS: "no-bullets",
    }
    return ChipView(
        check_id=result.check_id,
        passed=result.status == "pass",
        label=labels[result.check_id],
        evidence=result.evidence,
    )


def _history(
    records: Sequence[MessageRecord],
    *,
    before_turn: int,
    limit: int,
    model_id: str | None = None,
) -> list[Message]:
    """Build final history; when model_id is set, keep only that model's conversations."""
    by_turn: dict[int, list[MessageRecord]] = {}
    for record in records:
        if record.turn < before_turn:
            by_turn.setdefault(record.turn, []).append(record)
    messages: list[Message] = []
    for turn in sorted(by_turn):
        values = by_turn[turn]
        assistants = [value for value in values if value.attempt != "user" and value.is_final]
        if not assistants or (model_id and assistants[-1].model != model_id):
            continue
        users = [value for value in values if value.attempt == "user"]
        if users:
            messages.append(Message(role="user", content=users[-1].content))
        messages.append(Message(role="assistant", content=assistants[-1].content))
    return messages[-limit:]


@dataclass
class TurnRunner:
    ai: AIServices
    settings: Settings
    snapshot: SnapshotGetter

    def _state(self, session: SessionRecord, snapshot: L2Snapshot, before_turn: int | None = None) -> ContractState:
        return combine(
            self.ai.store.items(session.id),
            snapshot.items,
            session_id=session.id,
            project=session.project,
            prefs=session.prefs,
            before_turn=before_turn,
        )

    def _save_reply(
        self,
        session: SessionRecord,
        turn: int,
        model_id: str,
        text: str,
        attempt: str,
        memory_on: bool,
        results: Sequence[CheckResult],
    ) -> ReplyView:
        message_id = self.ai.store.save_message(MessageRecord(
            session_id=session.id,
            turn=turn,
            role="assistant",
            model=model_id,
            attempt=attempt,  # type: ignore[arg-type]
            memory_on=memory_on,
            is_final=False,
            content=redact(text),
            created_at=utcnow(),
        ))
        applicable = tuple(value for value in results if value.status != "n/a")
        self.ai.store.save_verifications(message_id, applicable)
        model = next(value for value in self.ai.chain.models() if value.profile.id == model_id)
        return ReplyView(
            message_id=message_id,
            model_id=model_id,
            model_label=model.profile.label,
            text=redact(text),
            memory_on=memory_on,
            attempt=attempt,  # type: ignore[arg-type]
            chips=tuple(_chip(value) for value in applicable),
        )

    def _extract(
        self,
        *,
        session: SessionRecord,
        turn: int,
        user_msg: str,
        reply: str,
        model_id: str,
        state: ContractState,
        replace: bool,
    ) -> tuple[Alert, ...]:
        result = self.ai.extractor.extract(
            user_msg=redact(user_msg),
            reply=redact(reply),
            contract_text=redact(render(state)),
        )
        alerts = list(result.alerts)
        existing = list(self.ai.store.items(session.id))
        created: list[Item] = []
        prefs = session.prefs
        for extracted in result.items:
            kind = ItemKind(extracted.kind)
            supersedes = None
            if kind == ItemKind.REVERSAL:
                target = resolve((*existing, *created), extracted.target or extracted.text, (ItemKind.REJECTION,))
                if target is None:
                    alerts.append(Alert(
                        level="amber",
                        code=AlertCode.REVERSAL_UNMATCHED,
                        message=f"Could not match reversal target: {extracted.target or extracted.text}",
                    ))
                    continue
                supersedes = target.id
            elif kind == ItemKind.RESOLVED:
                target = resolve((*existing, *created), extracted.target or extracted.text, (ItemKind.OPEN_QUESTION,))
                if target is None:
                    continue
                supersedes = target.id
            item = Item(
                id=new_id(),
                kind=kind,
                text=redact(extracted.text),
                reason=redact(extracted.reason) if extracted.reason else None,
                aliases=tuple(redact(value) for value in extracted.aliases),
                check_id=extracted.check_id,
                supersedes=supersedes,
                session_id=session.id,
                project=session.project,
                user=session.user,
                turn=turn,
                model=model_id,
                source="extractor",
                created_at=utcnow(),
            )
            if kind == ItemKind.REJECTION:
                item = item.model_copy(update={"aliases": validate_aliases(item, (*existing, *created))})
            if kind == ItemKind.PREFERENCE:
                if item.check_id == CheckId.NO_BULLETS:
                    prefs = prefs.model_copy(update={"no_bullets": True})
                elif item.text not in prefs.free_text:
                    prefs = prefs.model_copy(update={"free_text": (*prefs.free_text, item.text)})
            created.append(redact_item(item))

        if prefs != session.prefs:
            self.ai.store.update_session(session.id, prefs=prefs)
        if replace:
            self.ai.store.replace_turn_items(session.id, turn, created)
        else:
            self.ai.store.add_items(created)
        self.ai.memory.retain(session.project, turn_document_id(session.id, turn), created)
        return tuple(alerts)

    def run(
        self,
        session_id: str,
        user_msg: str,
        *,
        turn: int | None = None,
        memory_on: bool | None = None,
        forced_model: str | None = None,
        rerun: bool = False,
        earlier_attempts: Sequence[ReplyView] = (),
    ) -> TurnView:
        session = self.ai.store.get_session(session_id)
        turn = turn if turn is not None else self.ai.store.next_turn(session_id)
        memory_on = session.memory_on if memory_on is None else memory_on
        snapshot = self.snapshot(session.project, False)
        state = self._state(session, snapshot, before_turn=turn if rerun else None)
        contract_text = redact(render(state))
        records = self.ai.store.messages(session_id)
        alerts = list(snapshot.alerts)
        handoffs = [event for event_turn, event in self.ai.store.handoffs(session_id) if event_turn == turn]

        if not rerun:
            self.ai.store.save_message(MessageRecord(
                session_id=session_id,
                turn=turn,
                role="user",
                model=None,
                attempt="user",
                memory_on=memory_on,
                is_final=True,
                content=redact(user_msg),
                created_at=utcnow(),
            ))

        if forced_model:
            candidates = [model for model in self.ai.chain.models() if model.profile.id == forced_model]
            if not candidates:
                raise KeyError(forced_model)
        else:
            candidates = self.ai.chain.candidates(session_id)

        reply_view: ReplyView | None = None
        local_earlier = list(earlier_attempts)
        for index, model in enumerate(candidates):
            model_id = model.profile.id
            history = _history(
                records,
                before_turn=turn,
                limit=self.settings.history_window,
                model_id=None if memory_on else model_id,
            )
            levels = {
                CheckId.REJECTED: 0,
                CheckId.CONTINUITY: 0,
                CheckId.NO_BULLETS: 0,
            }
            messages = compose(
                user_msg=user_msg,
                history=history,
                state=state,
                contract_text=contract_text,
                memory_on=memory_on,
                levels=levels,
            )
            try:
                completion = model.complete(messages)
            except (RateLimited, ModelUnavailable) as exc:
                reason = "429" if isinstance(exc, RateLimited) else exc.reason
                retry_after = exc.retry_after if isinstance(exc, RateLimited) else None
                if isinstance(exc, RateLimited):
                    self.ai.chain.cool_down(model_id, exc.retry_after)
                else:
                    self.ai.chain.disable(model_id, exc.detail)
                    alerts.append(Alert(
                        level="red" if exc.reason == "auth" else "amber",
                        code=AlertCode.MODEL_UNAVAILABLE,
                        message=str(exc),
                    ))
                refreshed = self.snapshot(session.project, True)
                state = self._state(session, refreshed, before_turn=turn if rerun else None)
                contract_text = redact(render(state))
                if not state.has_context:
                    alerts.append(Alert(
                        level="red",
                        code=AlertCode.EMPTY_CONTRACT,
                        message="The handoff has no recalled Baton context; the next model starts without task state.",
                    ))
                next_id = candidates[index + 1].profile.id if index + 1 < len(candidates) else None
                event = HandoffEvent(
                    from_model=model_id,
                    to_model=next_id,
                    reason=reason,
                    retry_after=retry_after,
                    memories_recalled=len(refreshed.items),
                    at=utcnow(),
                )
                self.ai.store.log_handoff(session_id, turn, event)
                handoffs.append(event)
                continue

            text = strip_reasoning(completion.text)
            seen_model = any(value.model == model_id and value.attempt != "user" for value in records)
            results = verify(text, state, continuity=state.has_context and not seen_model)
            first = self._save_reply(
                session, turn, model_id, text, "rerun" if rerun else "first", memory_on, results
            )
            reply_view = first
            failures = [value for value in results if value.status == "fail"]
            if memory_on and failures and not rerun:
                repair_levels = dict(levels)
                for failure in failures:
                    repair_levels[failure.check_id] = 1
                repair_prompt = compose(
                    user_msg=user_msg,
                    history=history,
                    state=state,
                    contract_text=contract_text,
                    memory_on=True,
                    levels=repair_levels,
                )
                try:
                    repaired = model.complete(repair_prompt)
                    repaired_text = strip_reasoning(repaired.text)
                    repaired_results = verify(
                        repaired_text, state, continuity=state.has_context and not seen_model
                    )
                    local_earlier.append(first)
                    reply_view = self._save_reply(
                        session, turn, model_id, repaired_text, "repair", memory_on, repaired_results
                    )
                    text = repaired_text
                except RateLimited as exc:
                    self.ai.chain.cool_down(model_id, exc.retry_after)
                    alerts.append(Alert(
                        level="amber",
                        code=AlertCode.REPAIR_SKIPPED,
                        message="Repair retry was rate-limited; showing the first reply.",
                    ))
                except ModelUnavailable as exc:
                    alerts.append(Alert(
                        level="amber",
                        code=AlertCode.REPAIR_SKIPPED,
                        message=f"Repair retry was unavailable: {exc.detail}",
                    ))
            self.ai.chain.set_active(session_id, model_id)
            self.ai.store.set_final(session_id, turn, reply_view.message_id)
            alerts.extend(self._extract(
                session=session,
                turn=turn,
                user_msg=user_msg,
                reply=text,
                model_id=model_id,
                state=state,
                replace=rerun,
            ))
            break

        if reply_view is None:
            alerts.append(Alert(
                level="red",
                code=AlertCode.NO_MODEL,
                message="No model is currently available. Copy the Baton contract to continue elsewhere.",
            ))

        return TurnView(
            session_id=session_id,
            turn=turn,
            user_text=redact(user_msg),
            reply=reply_view,
            earlier_attempts=tuple(local_earlier),
            handoffs=tuple(handoffs),
            alerts=tuple(alerts),
            fallback_contract=contract_text if reply_view is None else None,
            can_rerun=reply_view is not None,
            rerun_memory_on=not memory_on if reply_view is not None else None,
        )


def run_turn(runner: TurnRunner, session_id: str, user_msg: str) -> TurnView:
    return runner.run(session_id, user_msg)


def rerun_last_turn(
    runner: TurnRunner,
    session_id: str,
    turn: int,
    user_msg: str,
    model_id: str,
    memory_on: bool,
    earlier_attempts: Sequence[ReplyView],
) -> TurnView:
    return runner.run(
        session_id,
        user_msg,
        turn=turn,
        memory_on=memory_on,
        forced_model=model_id,
        rerun=True,
        earlier_attempts=earlier_attempts,
    )
