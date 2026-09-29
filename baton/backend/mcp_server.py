"""Five typed tools, one server per external app, over the official MCP SDK."""
from __future__ import annotations

from typing import Callable
from urllib.parse import urlsplit

from anyio import to_thread
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from baton.backend.bridge import Bridge, ExternalApp
from baton.interfaces.types import ExtractedItem


def build_mcp(bridge: Bridge | Callable[[], Bridge], app: ExternalApp, *, public_url: str | None = None) -> FastMCP:
    if app not in ("chatgpt", "claude"):
        raise ValueError("Unknown bridge app")
    hosts = ["127.0.0.1:*", "localhost:*", "[::1]:*", "testserver"]
    origins = ["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"]
    if public_url:
        parsed = urlsplit(public_url)
        hosts.append(parsed.netloc)
        origins.append(f"{parsed.scheme}://{parsed.netloc}")
    server = FastMCP(
        f"Baton ({app})", stateless_http=True, json_response=True, streamable_http_path="/",
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=True, allowed_hosts=hosts, allowed_origins=origins,
        ),
    )

    async def call(method, *args):
        # Provider extraction/recall is synchronous; keep it off the ASGI event loop.
        def invoke():
            service = bridge() if callable(bridge) else bridge
            return getattr(service, method)(*args)
        return await to_thread.run_sync(invoke)

    @server.tool()
    async def pull_baton(project: str) -> str:
        """Get the Baton for a project: goal, next step, decisions, constraints,
        rejected approaches with reasons, and preferences recorded across ChatGPT,
        Claude and Baton. Call when the user says pick up, continue or resume a
        project, or mentions Baton.
        """
        return await call("pull", project, app)

    @server.tool()
    async def record_items(project: str, items: list[ExtractedItem]) -> str:
        """Record what the USER decided, only what they stated or accepted, never
        your own suggestions. Call after a user accepts, rejects or reverses an
        approach, sets a goal, constraint or preference, or changes the next step.
        Kinds: goal, decision, constraint, rejection (reason and aliases), reversal
        (target is the rejected approach), preference, next_step, open_question,
        resolved (target is the question).
        """
        return await call("record_items", project, app, items)

    @server.tool()
    async def record_exchange(project: str, user_message: str, assistant_reply: str) -> str:
        """Alternative to record_items: send the latest exchange and Baton extracts
        the user's decisions itself. Requires a configured extraction provider.
        """
        return await call("record_exchange", project, app, user_message, assistant_reply)

    @server.tool()
    async def check_reply(project: str, draft: str) -> dict:
        """Before sending an answer on a Baton project, check your draft. Returns
        failures with evidence and the rule to follow. If anything fails, rewrite
        the draft and check again before answering.
        """
        return await call("check", project, app, draft)

    @server.tool()
    async def get_ledger(project: str) -> list[dict]:
        """List rejected approaches with reasons, aliases, who rejected them,
        and whether they were reversed.
        """
        return [row.model_dump(mode="json") for row in await call("get_ledger", project, app)]

    return server
