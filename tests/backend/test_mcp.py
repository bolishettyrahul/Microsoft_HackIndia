import json
from datetime import timedelta

import httpx
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.memory import create_connected_server_and_client_session

from baton.backend.app import create_app
from baton.backend.bridge import Bridge
from baton.backend.facade import Baton
from baton.backend.mcp_server import build_mcp
from baton.backend.serve import MCPOnlyGateway
from baton.config import Settings
from baton.interfaces.types import ExtractResult, ExtractedItem
from .fakes import services

TOOLS = {"pull_baton", "record_items", "record_exchange", "check_reply", "get_ledger"}


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_all_tools_direct_and_sdk_in_memory_round_trip():
    ai = services([], ExtractResult(items=(ExtractedItem(kind="next_step", text="Implement TTL"),)))
    server = build_mcp(Bridge(ai, Settings()), "chatgpt")
    assert {t.name for t in await server.list_tools()} == TOOLS
    await server.call_tool("record_items", {"project": "demo", "items": [{"kind": "rejection", "text": "Redis", "reason": "free tier"}]})
    await server.call_tool("record_exchange", {"project": "demo", "user_message": "Implement TTL", "assistant_reply": "OK"})
    for name, args in (
        ("pull_baton", {"project": "demo"}),
        ("check_reply", {"project": "demo", "draft": "Use Redis"}),
        ("get_ledger", {"project": "demo"}),
    ):
        assert await server.call_tool(name, args)
    async with create_connected_server_and_client_session(server, read_timeout_seconds=timedelta(seconds=10)) as client:
        assert {t.name for t in (await client.list_tools()).tools} == TOOLS
        result = await client.call_tool("pull_baton", {"project": "demo"})
        assert not result.isError
        assert "Redis" in result.content[0].text
        invalid = await client.call_tool("record_items", {"project": "demo", "items": [{"kind": "not-a-kind", "text": "bad"}]})
        assert invalid.isError


@pytest.mark.anyio
async def test_two_mounted_servers_with_real_streamable_http_sdk_client():
    ai = services([])
    api = Baton(Settings(ai="fake", mcp_token="test-mcp-token-for-roundtrip"), ai)
    app = create_app(api)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost:8000", follow_redirects=True) as http:
            setup = (await http.get("/api/bridge/setup")).json()
            for source in ("chatgpt", "claude"):
                url = setup["claude_url"].replace("/claude/", f"/{source}/")
                async with streamable_http_client(url, http_client=http) as (read, write, _):
                    async with ClientSession(read, write, read_timeout_seconds=timedelta(seconds=10)) as client:
                        await client.initialize()
                        assert {t.name for t in (await client.list_tools()).tools} == TOOLS
                        if source == "chatgpt":
                            result = await client.call_tool("record_items", {"project": "demo", "items": [{"kind": "rejection", "text": "Redis"}]})
                        else:
                            result = await client.call_tool("pull_baton", {"project": "demo"})
                            assert "Redis" in result.content[0].text
                            failed = await client.call_tool("check_reply", {"project": "demo", "draft": "Use Redis"})
                            assert not failed.isError
                            assert json.loads(failed.content[0].text)["passed"] is False
                        assert not result.isError
            view = (await http.get("/api/projects/demo/bridge")).json()
            assert {e["app"] for e in view["events"]} == {"chatgpt", "claude"}
            assert [e["action"] for e in view["events"]] == ["check", "pull", "record"]
            assert (await http.post("/mcp/claude/wrong-token/")).status_code == 404
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=MCPOnlyGateway(app)), base_url="https://public.example") as public:
            assert (await public.get("/api/bridge/setup")).status_code == 404
            assert (await public.get("/api/projects")).status_code == 404
            assert (await public.get("/docs")).status_code == 404


@pytest.mark.anyio
async def test_mcp_rejects_untrusted_hosts_and_origins():
    app = create_app(Baton(Settings(ai="fake", mcp_token="private-token-for-host-check"), services([])))
    path = "/mcp/claude/private-token-for-host-check/"
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost:8000") as http:
            assert (await http.post(path, headers={"Host": "evil.example"}, json={})).status_code == 421
            assert (await http.post(path, headers={"Origin": "https://evil.example"}, json={})).status_code == 403
