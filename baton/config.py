"""Settings read from the environment (and .env). Owned by main; sectors read, never edit."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv


def _split(value: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in value.split(",") if part.strip())


@dataclass(frozen=True)
class Settings:
    groq_api_key: str | None = None
    gemini_api_key: str | None = None
    openai_api_key: str | None = None
    hindsight_api_key: str | None = None
    hindsight_base_url: str = "https://api.hindsight.vectorize.io"
    model_chain: tuple[str, ...] = (
        "groq:openai/gpt-oss-120b",
        "gemini:gemini-3.5-flash",
        "groq:qwen/qwen3.8-27b",
    )
    extractor_chain: tuple[str, ...] = (
        "groq:openai/gpt-oss-20b",
        "gemini:gemini-3.5-flash-lite",
    )
    ai: str = "real"  # "real" or "fake"
    mcp_token: str | None = None
    public_url: str | None = None
    db_path: str = "baton.db"
    history_window: int = 6
    recall_timeout: float = 5.0
    extra: dict[str, str] = field(default_factory=dict)


def load_settings() -> Settings:
    """Build Settings from the process environment, after loading .env if present."""
    load_dotenv()
    defaults = Settings()
    return Settings(
        groq_api_key=os.getenv("GROQ_API_KEY") or None,
        gemini_api_key=os.getenv("GEMINI_API_KEY") or None,
        openai_api_key=os.getenv("OPENAI_API_KEY") or None,
        hindsight_api_key=os.getenv("HINDSIGHT_API_KEY") or None,
        hindsight_base_url=os.getenv("HINDSIGHT_BASE_URL") or defaults.hindsight_base_url,
        model_chain=_split(os.getenv("BATON_MODEL_CHAIN", "")) or defaults.model_chain,
        extractor_chain=_split(os.getenv("BATON_EXTRACTOR_CHAIN", "")) or defaults.extractor_chain,
        ai=os.getenv("BATON_AI", defaults.ai),
        mcp_token=os.getenv("BATON_MCP_TOKEN") or None,
        public_url=os.getenv("BATON_PUBLIC_URL") or None,
        db_path=os.getenv("BATON_DB_PATH", defaults.db_path),
        history_window=int(os.getenv("BATON_HISTORY_WINDOW", defaults.history_window)),
        recall_timeout=float(os.getenv("BATON_RECALL_TIMEOUT", defaults.recall_timeout)),
    )
