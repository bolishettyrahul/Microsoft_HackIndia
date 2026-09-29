"""Merge a running Baton's connection into Claude Desktop, preserving other settings.

python -m baton.backend.connect_claude --url http://localhost:8000 --config PATH
"""
from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import httpx


def merge_config(path: Path, snippet: str) -> Path | None:
    incoming = json.loads(snippet)["mcpServers"]["baton"]
    current = json.loads(path.read_text(encoding="utf-8-sig")) if path.exists() else {}
    if not isinstance(current, dict) or not isinstance(current.get("mcpServers", {}), dict):
        raise ValueError("Claude configuration must be a JSON object with an object mcpServers")
    if current.get("mcpServers", {}).get("baton") == incoming:
        return None
    backup = None
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup = path.with_name(f"{path.name}.baton-backup-{stamp}")
        shutil.copy2(path, backup)
    current.setdefault("mcpServers", {})["baton"] = incoming
    temporary = path.with_name(path.name + ".baton-tmp")
    temporary.write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)
    return backup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8000")
    parser.add_argument("--config", required=True, type=Path)
    args = parser.parse_args()
    parsed = urlsplit(args.url)
    if parsed.scheme != "http" or parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        parser.error("Use the local management listener URL")
    response = httpx.get(args.url.rstrip("/") + "/api/bridge/setup", timeout=10)
    response.raise_for_status()
    backup = merge_config(args.config, response.json()["claude_desktop_config"])
    print("Baton connection saved. Restart Claude Desktop to load its five tools.")
    if backup:
        print(f"Previous configuration backed up to {backup}")


if __name__ == "__main__":
    main()
