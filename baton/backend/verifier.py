"""Deterministic reply checks. No model is involved in verification."""

from __future__ import annotations

import re

from baton.backend.contract import ContractState
from baton.interfaces.types import CheckId, CheckResult


_FENCES = re.compile(r"```.*?```", re.DOTALL)
_LIST_LINE = re.compile(r"(?m)^\s*(?:[-*•]|\d+[.)])\s+")
_CONTINUITY = (
    "what are you building",
    "can you share more about",
    "tell me more about your project",
    "what is the project",
    "what's the project",
)
_NEGATE_BEFORE = {
    "not", "no", "never", "avoid", "avoiding", "skip", "skipping", "without",
    "instead", "rather", "won't", "don't", "can't", "drop",
}
_NEGATE_AFTER = (
    "is ruled out", "was rejected", "is out", "is off the table", "is not an option",
)


def _sentence(text: str, start: int) -> str:
    left = max(text.rfind(".", 0, start), text.rfind("\n", 0, start)) + 1
    candidates = [value for value in (text.find(".", start), text.find("\n", start)) if value >= 0]
    right = min(candidates) + 1 if candidates else len(text)
    return text[left:right].strip()


def _rejected(reply: str, state: ContractState) -> CheckResult:
    if not state.rejections:
        return CheckResult(check_id=CheckId.REJECTED, status="n/a")
    for item in state.rejections:
        for alias in (item.text, *item.aliases):
            pattern = re.compile(rf"(?<!\w){re.escape(alias)}(?!\w)", re.IGNORECASE)
            for match in pattern.finditer(reply):
                before = re.findall(r"[\w']+", reply[max(0, match.start() - 80):match.start()].casefold())[-5:]
                after = reply[match.end():match.end() + 80].casefold().strip(" ,:;-.")
                before_text = " ".join(before)
                negated = bool(_NEGATE_BEFORE.intersection(before))
                negated = negated or "instead of" in before_text or "rather than" in before_text
                negated = negated or any(after.startswith(value) for value in _NEGATE_AFTER)
                if not negated:
                    return CheckResult(
                        check_id=CheckId.REJECTED,
                        status="fail",
                        evidence=_sentence(reply, match.start()),
                    )
    return CheckResult(check_id=CheckId.REJECTED, status="pass")


def verify(reply: str, state: ContractState, *, continuity: bool) -> tuple[CheckResult, ...]:
    """Run all contracted checks, returning n/a for checks that do not apply."""
    results = [_rejected(reply, state)]
    lowered = reply.casefold()
    if continuity:
        phrase = next((value for value in _CONTINUITY if value in lowered), None)
        results.append(CheckResult(
            check_id=CheckId.CONTINUITY,
            status="fail" if phrase else "pass",
            evidence=phrase or "",
        ))
    else:
        results.append(CheckResult(check_id=CheckId.CONTINUITY, status="n/a"))

    if state.preferences.no_bullets:
        count = len(_LIST_LINE.findall(_FENCES.sub("", reply)))
        results.append(CheckResult(
            check_id=CheckId.NO_BULLETS,
            status="fail" if count else "pass",
            evidence=f"{count} list line{'s' if count != 1 else ''}" if count else "",
        ))
    else:
        results.append(CheckResult(check_id=CheckId.NO_BULLETS, status="n/a"))
    return tuple(results)
