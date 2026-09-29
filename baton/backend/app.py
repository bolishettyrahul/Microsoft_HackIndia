"""FastAPI transport for the backend/frontend contract."""

from __future__ import annotations

from contextlib import AsyncExitStack, asynccontextmanager
from threading import Lock

from fastapi import FastAPI, HTTPException, Request
from pydantic import ValidationError

from baton.backend.facade import Baton
from baton.backend.wiring import build_baton
from baton.backend.bridge_setup import connection_settings, setup_view
from baton.backend.mcp_server import build_mcp
from baton.config import load_settings
from baton.interfaces.api import (
    ReverseRejection,
    SendMessage,
    StartSession,
    UpdateSession,
    UseModel,
    BridgeView,
    BridgeSetup,
    ImportExchange,
)


def create_app(api: Baton | None = None) -> FastAPI:
    settings = api.settings if api is not None else load_settings()
    token, public_url = connection_settings(settings)
    servers = []

    @asynccontextmanager
    async def lifespan(application):
        async with AsyncExitStack() as stack:
            for server in servers:
                await stack.enter_async_context(server.session_manager.run())
            yield

    application = FastAPI(title="Baton API", version="2.0", lifespan=lifespan)
    application.state.mcp_token = token
    build_lock = Lock()
    if api is not None:
        application.state.baton = api

    def backend() -> Baton:
        with build_lock:
            if not hasattr(application.state, "baton"):
                application.state.baton = build_baton(settings)
        return application.state.baton

    def call(method, *args, **kwargs):
        try:
            return method(*args, **kwargs)
        except KeyError as exc:
            detail = str(exc.args[0]) if exc.args else "Not found"
            raise HTTPException(status_code=404, detail=detail) from exc
        except (ValueError, ValidationError) as exc:
            raise HTTPException(status_code=422, detail="Invalid bridge request" if isinstance(exc, ValidationError) else str(exc)) from exc

    @application.get("/api/projects/{project}/bridge", response_model=BridgeView)
    def bridge_view(project: str):
        return call(backend().bridge.view, project)

    @application.get("/api/bridge/setup", response_model=BridgeSetup)
    def bridge_setup(request: Request):
        return setup_view(token, public_url, local_url=str(request.base_url).rstrip("/"))

    @application.post("/api/projects/{project}/import", response_model=BridgeView)
    def import_exchange(project: str, body: ImportExchange):
        return call(backend().bridge.import_exchange, project, body.app, body.user_message, body.assistant_reply)

    @application.get("/api/health")
    def health():
        return backend().health()

    @application.get("/api/projects")
    def projects():
        return backend().projects()

    @application.post("/api/sessions")
    def start(body: StartSession):
        return backend().start_session(body.project, body.user, body.memory_on)

    @application.get("/api/sessions/{sid}")
    def session(sid: str):
        return call(backend().session, sid)

    @application.patch("/api/sessions/{sid}")
    def update(sid: str, body: UpdateSession):
        return call(backend().update_session, sid, memory_on=body.memory_on, prefs=body.prefs)

    @application.get("/api/sessions/{sid}/turns")
    def turns(sid: str):
        return call(backend().turns, sid)

    @application.post("/api/sessions/{sid}/turns")
    def send(sid: str, body: SendMessage):
        return call(backend().send, sid, body.text)

    @application.post("/api/sessions/{sid}/rerun")
    def rerun(sid: str):
        return call(backend().rerun, sid)

    @application.get("/api/sessions/{sid}/models")
    def models(sid: str):
        return call(backend().models, sid)

    @application.post("/api/sessions/{sid}/models/switch")
    def switch(sid: str):
        return call(backend().switch_model, sid)

    @application.post("/api/sessions/{sid}/models/use")
    def use(sid: str, body: UseModel):
        return call(backend().use_model, sid, body.model_id)

    @application.post("/api/models/burst")
    def burst(body: UseModel):
        try:
            return backend().burst(body.model_id)
        except (KeyError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @application.get("/api/sessions/{sid}/contract")
    def contract(sid: str):
        return call(backend().contract, sid)

    @application.get("/api/sessions/{sid}/ledger")
    def ledger(sid: str):
        return call(backend().ledger, sid)

    @application.post("/api/sessions/{sid}/ledger/reverse")
    def reverse(sid: str, body: ReverseRejection):
        return call(backend().reverse, sid, body.item_id, body.reason)

    @application.get("/api/sessions/{sid}/trace")
    def trace(sid: str):
        return call(backend().trace, sid)

    @application.post("/api/sessions/{sid}/memory/refresh")
    def refresh(sid: str):
        return call(backend().trace, sid, refresh=True)

    for source in ("claude", "chatgpt"):
        server = build_mcp(lambda: backend().bridge, source, public_url=public_url)
        application.mount(f"/mcp/{source}/{token}", server.streamable_http_app())
        servers.append(server)
    application.state.mcp_servers = tuple(servers)
    return application


app = create_app()
