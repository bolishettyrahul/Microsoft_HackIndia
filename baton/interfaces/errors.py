"""The only exceptions that cross the AI -> backend boundary."""

from __future__ import annotations

from typing import Literal


class BatonError(Exception):
    """Base class for Baton's own errors."""


class RateLimited(BatonError):
    """The provider returned 429. retry_after is seconds (60.0 if the provider gave none)."""

    def __init__(self, model_id: str, retry_after: float = 60.0) -> None:
        super().__init__(f"{model_id} rate-limited; retry after {retry_after:.0f}s")
        self.model_id = model_id
        self.retry_after = retry_after


class ModelUnavailable(BatonError):
    """Any other provider failure: auth (401/403), bad_request (400) or error (5xx, timeout)."""

    def __init__(
        self,
        model_id: str,
        reason: Literal["auth", "bad_request", "error"],
        detail: str = "",
    ) -> None:
        super().__init__(f"{model_id} unavailable ({reason}): {detail}")
        self.model_id = model_id
        self.reason = reason
        self.detail = detail
