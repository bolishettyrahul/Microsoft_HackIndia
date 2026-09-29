"""Shared item construction for chat extraction and future bridge imports.

This module has no store or provider dependencies. The caller supplies the
project/session items that reversal and resolved targets may reference.
"""
from __future__ import annotations

from typing import Sequence

from baton.backend.contract import resolve, validate_aliases
from baton.backend.redact import redact, redact_item
from baton.interfaces.ai import SessionRecord
from baton.interfaces.types import (
    Alert, AlertCode, CheckId, ExtractResult, Item, ItemKind, Preferences, new_id, utcnow,
)


def build_items(
    result: ExtractResult,
    *,
    session: SessionRecord,
    turn: int,
    model_id: str | None,
    existing: Sequence[Item],
) -> tuple[list[Item], Preferences, tuple[Alert, ...]]:
    """Resolve targets, enforce alias rules, redact and derive preferences."""
    alerts = list(result.alerts)
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
                    message=redact(f"Could not match reversal target: {extracted.target or extracted.text}"),
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
    return created, prefs, tuple(alerts)
