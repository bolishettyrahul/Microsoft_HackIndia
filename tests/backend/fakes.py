"""Compatibility re-exports; the fake implementation is production fake mode."""

from baton.backend.fake_ai import (
    FakeChain,
    FakeExtractor,
    FakeMemory,
    FakeModel,
    FakeStore,
    build_fake_ai,
    services,
)

__all__ = [
    "FakeChain", "FakeExtractor", "FakeMemory", "FakeModel", "FakeStore",
    "build_fake_ai", "services",
]
