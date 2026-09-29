"""Connection URLs and Claude Desktop configuration, without storing secrets."""
from __future__ import annotations

import json
import re
import secrets
from urllib.parse import urlsplit

from baton.config import Settings
from baton.interfaces.api import BridgeSetup


def connection_settings(settings: Settings) -> tuple[str, str | None]:
    token = settings.mcp_token or secrets.token_urlsafe(32)
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,}", token):
        raise ValueError("BATON_MCP_TOKEN must have at least 16 URL-safe characters")
    public = settings.public_url.rstrip("/") if settings.public_url else None
    if public:
        parsed = urlsplit(public)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or parsed.path or parsed.query or parsed.fragment):
            raise ValueError("BATON_PUBLIC_URL must be an HTTPS origin without a path, query or credentials")
    return token, public


def setup_view(token: str, public_url: str | None, *, local_url: str = "http://localhost:8000") -> BridgeSetup:
    claude_url = f"{local_url}/mcp/claude/{token}/"
    config = {"mcpServers": {"baton": {"command": "npx", "args": ["-y", "mcp-remote", claude_url]}}}
    return BridgeSetup(
        claude_desktop_config=json.dumps(config, indent=2), claude_url=claude_url,
        chatgpt_url=f"{public_url}/mcp/chatgpt/{token}/" if public_url else None,
        public_claude_url=f"{public_url}/mcp/claude/{token}/" if public_url else None,
    )
