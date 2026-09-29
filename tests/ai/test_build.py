from baton.ai.build import _profile, build_ai
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


def test_openai_profile_uses_native_compatible_endpoint() -> None:
    profile = _profile("openai:gpt-5.1")

    assert profile.provider == "openai"
    assert profile.model == "gpt-5.1"
    assert profile.base_url == "https://api.openai.com/v1"
    assert profile.label == "gpt-5.1 · OpenAI"
    assert profile.burstable is False


def test_openai_model_without_key_is_visibly_disabled() -> None:
    services = build_ai(
        Settings(
            model_chain=("openai:gpt-5.1",),
            extractor_chain=(),
            db_path=":memory:",
        )
    )

    status = services.chain.status("session")[0]
    assert status.state == ModelState.DISABLED
    assert status.detail == "OPENAI_API_KEY is not configured"
