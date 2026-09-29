from baton.ai.build import build_ai
from baton.ai.hindsight import UnavailableLongTermMemory
from baton.config import Settings
from baton.interfaces.types import AlertCode
from baton.interfaces.ai import ModelState


def test_build_without_keys_is_visible_and_offline_safe() -> None:
    services = build_ai(Settings(db_path=":memory:"))
    statuses = services.chain.status("session")
    assert statuses
    assert all(status.state == ModelState.DISABLED for status in statuses)
    assert isinstance(services.memory, UnavailableLongTermMemory)
    assert services.memory.snapshot("project").alerts


def test_build_survives_hindsight_client_startup_failure() -> None:
    def broken_client():
        raise RuntimeError("boom")

    services = build_ai(
        Settings(hindsight_api_key="configured", db_path=":memory:"),
        hindsight_client_factory=broken_client,
    )

    snapshot = services.memory.snapshot("project")
    assert isinstance(services.memory, UnavailableLongTermMemory)
    assert snapshot.alerts[0].code == AlertCode.LTM_UNAVAILABLE
    assert "boom" in snapshot.alerts[0].message
