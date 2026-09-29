import json

import pytest

from baton.backend.bridge_setup import connection_settings
from baton.backend.connect_claude import merge_config
from baton.config import Settings


def test_connection_tokens_are_random_and_public_urls_validated():
    a, _ = connection_settings(Settings())
    b, _ = connection_settings(Settings())
    assert len(a) >= 32 and a != b
    for settings in (Settings(mcp_token="short"), Settings(public_url="http://example.com"),
                     Settings(public_url="https://example.com/mcp"), Settings(public_url="https://user:secret@example.com")):
        with pytest.raises(ValueError):
            connection_settings(settings)


def test_claude_config_merge_preserves_other_servers_and_creates_backup(tmp_path):
    path = tmp_path / "claude_desktop_config.json"
    original = {"theme": "dark", "mcpServers": {"existing": {"command": "keep-me"}}}
    path.write_text(json.dumps(original), encoding="utf-8")
    snippet = json.dumps({"mcpServers": {"baton": {"command": "npx", "args": ["-y", "mcp-remote", "http://localhost:8000/mcp/claude/test/"]}}})
    backup = merge_config(path, snippet)
    assert json.loads(backup.read_text()) == original
    merged = json.loads(path.read_text())
    assert merged["theme"] == "dark" and merged["mcpServers"]["existing"] == original["mcpServers"]["existing"]
    assert "baton" in merged["mcpServers"]
    assert merge_config(path, snippet) is None
