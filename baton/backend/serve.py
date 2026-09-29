"""Run local management on 8000 and a tunnel-safe MCP-only listener on 8001.

Usage: python -m baton.backend.serve
Point a tunnel at http://localhost:8001, never at the management listener.
"""
from __future__ import annotations

import argparse
import asyncio
from contextlib import nullcontext

import uvicorn
from starlette.responses import JSONResponse

from baton.backend.app import create_app


class MCPOnlyGateway:
    """The public listener cannot route to setup, docs or the management API."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].startswith("/mcp/"):
            await self.app(scope, receive, send)
        elif scope["type"] == "http":
            await JSONResponse({"detail": "Not found"}, status_code=404)(scope, receive, send)
        elif scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})


async def serve(port: int, public_port: int):
    if port == public_port:
        raise ValueError("Local and public listener ports must differ")
    app = create_app()
    servers = [uvicorn.Server(uvicorn.Config(target, host="127.0.0.1", port=p,
                                           lifespan="off", access_log=False))
               for target, p in ((app, port), (MCPOnlyGateway(app), public_port))]
    # asyncio.run owns Ctrl+C; do not install competing handlers for two listeners.
    for server in servers:
        server.capture_signals = nullcontext
    async with app.router.lifespan_context(app):
        tasks = [asyncio.create_task(s.serve()) for s in servers]
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for server in servers:
                server.should_exit = True
            await asyncio.gather(*tasks, return_exceptions=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--public-port", type=int, default=8001)
    args = parser.parse_args()
    try:
        asyncio.run(serve(args.port, args.public_port))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
