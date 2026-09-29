"""Composition root. This is the only backend module allowed to import baton.ai."""

from __future__ import annotations

from baton.backend.facade import Baton
from baton.config import Settings
from baton.interfaces.ai import AIServices


def build_baton(settings: Settings, ai: AIServices | None = None) -> Baton:
    if ai is None:
        if settings.ai == "fake":
            from baton.backend.fake_ai import build_fake_ai

            ai = build_fake_ai(settings)
        else:
            from baton.ai.build import build_ai

            ai = build_ai(settings)
    return Baton(settings, ai)
