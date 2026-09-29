"""FastAPI transport for the backend/frontend contract."""

from __future__ import annotations

from fastapi import FastAPI, HTTPException

from baton.backend.facade import Baton
from baton.backend.wiring import build_baton
from baton.config import load_settings
from baton.interfaces.api import (
    ReverseRejection,
    SendMessage,
    StartSession,
    UpdateSession,
    UseModel,
)


def create_app(api: Baton | None = None) -> FastAPI:
    application = FastAPI(title="Baton API", version="1.0")
    if api is not None:
        application.state.baton = api

    def backend() -> Baton:
        if not hasattr(application.state, "baton"):
            application.state.baton = build_baton(load_settings())
        return application.state.baton

    def call(method, *args, **kwargs):
        try:
            return method(*args, **kwargs)
        except KeyError as exc:
            detail = str(exc.args[0]) if exc.args else "Not found"
            raise HTTPException(status_code=404, detail=detail) from exc

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

    return application


app = create_app()
