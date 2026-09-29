"""Composition root for the AI sector."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from baton.ai.chain import RuntimeModelChain
from baton.ai.extractor import StructuredExtractor
from baton.ai.hindsight import HindsightLongTermMemory, UnavailableLongTermMemory
from baton.ai.provider import OpenAICompatModel
from baton.ai.store import SQLiteStore
from baton.interfaces.ai import AIServices, ModelProfile

_BASE_URLS = {
    "groq": "https://api.groq.com/openai/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/",
}


def _profile(model_id: str) -> ModelProfile:
    try:
        provider, model = model_id.split(":", 1)
    except ValueError as error:
        raise ValueError(f"invalid model id {model_id!r}; expected provider:model") from error
    if provider not in _BASE_URLS:
        raise ValueError(f"unsupported model provider {provider!r}")
    provider_name = "Groq" if provider == "groq" else "Gemini"
    return ModelProfile(
        id=model_id,
        label=f"{model.rsplit('/', 1)[-1]} · {provider_name}",
        provider=provider,
        model=model,
        base_url=_BASE_URLS[provider],
        burstable=provider == "groq",
    )


def _key(settings: Any, provider: str) -> str | None:
    return settings.groq_api_key if provider == "groq" else settings.gemini_api_key


def _model(settings: Any, model_id: str) -> OpenAICompatModel:
    profile = _profile(model_id)
    return OpenAICompatModel(profile, _key(settings, profile.provider))


def build_ai(
    settings: Any,
    *,
    hindsight_client_factory: Callable[[], Any] | None = None,
) -> AIServices:
    """Build the long-lived services consumed by the backend."""
    chat_models = [_model(settings, model_id) for model_id in settings.model_chain]
    chain = RuntimeModelChain(chat_models)
    for model in chat_models:
        if not _key(settings, model.profile.provider):
            variable = "GROQ_API_KEY" if model.profile.provider == "groq" else "GEMINI_API_KEY"
            chain.disable(model.profile.id, f"{variable} is not configured")

    extractor_models = [_model(settings, model_id) for model_id in settings.extractor_chain]
    extractor = StructuredExtractor(extractor_models)
    store = SQLiteStore(settings.db_path)
    if settings.hindsight_api_key:
        try:
            memory = HindsightLongTermMemory(
                settings.hindsight_base_url,
                settings.hindsight_api_key,
                client_factory=hindsight_client_factory,
            )
        except RuntimeError as error:
            cause = error.__cause__ or error
            memory = UnavailableLongTermMemory(
                f"Hindsight client failed to start: {cause}; using local memory only."
            )
    else:
        memory = UnavailableLongTermMemory()
    return AIServices(chain=chain, extractor=extractor, store=store, memory=memory)
