"""Secret and personal-data redaction at the backend storage boundary."""

from __future__ import annotations

import re
from collections.abc import Iterable

from baton.interfaces.types import Item


_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("groq", re.compile(r"gsk_[A-Za-z0-9]{20,}")),
    ("openai_anthropic", re.compile(r"sk-[A-Za-z0-9_-]{20,}")),
    ("google", re.compile(r"AIza[0-9A-Za-z_-]{35}")),
    ("github", re.compile(r"ghp_[A-Za-z0-9]{36}")),
    ("aws", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("jwt", re.compile(r"eyJ[\w-]+\.[\w-]+\.[\w-]+")),
    (
        "env_line",
        re.compile(r"(?i)\b(?:key|token|secret|password)\s*[=:]\s*\S+"),
    ),
    (
        "email",
        re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    ),
)


def redact(text: str) -> str:
    """Replace supported secrets and email addresses with typed markers."""
    for name, pattern in _PATTERNS:
        text = pattern.sub(f"[REDACTED:{name}]", text)
    return text


def redact_item(item: Item) -> Item:
    """Return a redacted copy of an immutable contract item."""
    return item.model_copy(
        update={
            "text": redact(item.text),
            "reason": redact(item.reason) if item.reason else None,
            "aliases": tuple(redact(alias) for alias in item.aliases),
        }
    )


def redact_items(items: Iterable[Item]) -> tuple[Item, ...]:
    return tuple(redact_item(item) for item in items)
