"""SQLite implementation of the AI sector's durable L1 store."""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Sequence
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from baton.interfaces.ai import MessageRecord, SessionRecord
from baton.interfaces.types import (
    CheckId,
    BridgeActivity,
    BridgeEvent,
    CheckResult,
    HandoffEvent,
    Item,
    Preferences,
    RecallTrace,
    new_id,
    utcnow,
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    user TEXT NOT NULL,
    memory_on INTEGER NOT NULL,
    prefs_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    turn INTEGER NOT NULL,
    role TEXT NOT NULL,
    model TEXT,
    attempt TEXT NOT NULL,
    memory_on INTEGER NOT NULL,
    is_final INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session_turn
    ON messages(session_id, turn, id);
CREATE TABLE IF NOT EXISTS verifications (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    check_id TEXT NOT NULL,
    status TEXT NOT NULL,
    evidence TEXT NOT NULL,
    PRIMARY KEY (message_id, check_id)
);
CREATE TABLE IF NOT EXISTS contract_items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    reason TEXT,
    aliases_json TEXT NOT NULL,
    check_id TEXT,
    supersedes TEXT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    project TEXT NOT NULL,
    user TEXT NOT NULL,
    turn INTEGER NOT NULL,
    model TEXT,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_session_turn
    ON contract_items(session_id, turn, created_at);
CREATE TABLE IF NOT EXISTS handoffs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    turn INTEGER NOT NULL,
    from_model TEXT NOT NULL,
    to_model TEXT,
    reason TEXT NOT NULL,
    retry_after REAL,
    memories_recalled INTEGER NOT NULL,
    at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recalls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    turn INTEGER NOT NULL,
    purpose TEXT NOT NULL,
    query TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    result_count INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    error TEXT
);
CREATE INDEX IF NOT EXISTS idx_recalls_session_turn
    ON recalls(session_id, turn, id);
CREATE INDEX IF NOT EXISTS idx_items_project ON contract_items(project, created_at);
CREATE TABLE IF NOT EXISTS bridge_sessions (
    project TEXT NOT NULL,
    app TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    last_turn INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(project, app),
    UNIQUE(session_id)
);
CREATE TABLE IF NOT EXISTS bridge_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL,
    at TEXT NOT NULL,
    app TEXT NOT NULL,
    action TEXT NOT NULL,
    summary TEXT NOT NULL,
    items INTEGER NOT NULL,
    passed INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bridge_events_project_at ON bridge_events(project, at);
"""


def _dt(value: str) -> datetime:
    return datetime.fromisoformat(value)


class SQLiteStore:
    """One SQLite connection per thread, with a shared schema and WAL mode."""

    def __init__(self, path: str) -> None:
        self._local = threading.local()
        self._schema_lock = threading.Lock()
        self._uri = False
        self._anchor: sqlite3.Connection | None = None
        if path == ":memory:":
            self._path = f"file:baton-{uuid4().hex}?mode=memory&cache=shared"
            self._uri = True
            self._anchor = self._new_connection()
            self._initialise(self._anchor)
        else:
            target = Path(path)
            if target.parent != Path("."):
                target.parent.mkdir(parents=True, exist_ok=True)
            self._path = str(target)
            connection = self._new_connection()
            self._initialise(connection)
            connection.close()

    def _new_connection(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            self._path,
            uri=self._uri,
            timeout=5.0,
            isolation_level=None,
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=5000")
        connection.execute("PRAGMA journal_mode=WAL")
        return connection

    def _initialise(self, connection: sqlite3.Connection) -> None:
        with self._schema_lock:
            connection.executescript(_SCHEMA)

    def _connection(self) -> sqlite3.Connection:
        connection = getattr(self._local, "connection", None)
        if connection is None:
            connection = self._new_connection()
            self._initialise(connection)
            self._local.connection = connection
        return connection

    @staticmethod
    def _session(row: sqlite3.Row) -> SessionRecord:
        return SessionRecord(
            id=row["id"],
            project=row["project"],
            user=row["user"],
            memory_on=bool(row["memory_on"]),
            prefs=Preferences.model_validate_json(row["prefs_json"]),
            created_at=_dt(row["created_at"]),
        )

    @staticmethod
    def _message(row: sqlite3.Row) -> MessageRecord:
        return MessageRecord(
            id=row["id"],
            session_id=row["session_id"],
            turn=row["turn"],
            role=row["role"],
            model=row["model"],
            attempt=row["attempt"],
            memory_on=bool(row["memory_on"]),
            is_final=bool(row["is_final"]),
            content=row["content"],
            created_at=_dt(row["created_at"]),
        )

    @staticmethod
    def _item(row: sqlite3.Row) -> Item:
        return Item(
            id=row["id"],
            kind=row["kind"],
            text=row["text"],
            reason=row["reason"],
            aliases=tuple(json.loads(row["aliases_json"])),
            check_id=row["check_id"],
            supersedes=row["supersedes"],
            session_id=row["session_id"],
            project=row["project"],
            user=row["user"],
            turn=row["turn"],
            model=row["model"],
            source=row["source"],
            created_at=_dt(row["created_at"]),
        )

    def create_session(self, project: str, user: str, memory_on: bool) -> SessionRecord:
        record = SessionRecord(
            id=new_id(),
            project=project,
            user=user,
            memory_on=memory_on,
            created_at=utcnow(),
        )
        self._connection().execute(
            "INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?)",
            (
                record.id,
                record.project,
                record.user,
                int(record.memory_on),
                record.prefs.model_dump_json(),
                record.created_at.isoformat(),
            ),
        )
        return record

    def get_session(self, session_id: str) -> SessionRecord:
        row = self._connection().execute(
            "SELECT * FROM sessions WHERE id=?", (session_id,)
        ).fetchone()
        if row is None:
            raise KeyError(session_id)
        return self._session(row)

    def update_session(
        self,
        session_id: str,
        *,
        memory_on: bool | None = None,
        prefs: Preferences | None = None,
    ) -> SessionRecord:
        current = self.get_session(session_id)
        updated_memory = current.memory_on if memory_on is None else memory_on
        updated_prefs = current.prefs if prefs is None else prefs
        self._connection().execute(
            "UPDATE sessions SET memory_on=?, prefs_json=? WHERE id=?",
            (int(updated_memory), updated_prefs.model_dump_json(), session_id),
        )
        return self.get_session(session_id)

    def list_projects(self) -> list[str]:
        rows = self._connection().execute(
            "SELECT DISTINCT project FROM sessions ORDER BY project COLLATE NOCASE"
        ).fetchall()
        return [row["project"] for row in rows]

    def next_turn(self, session_id: str) -> int:
        self.get_session(session_id)
        row = self._connection().execute(
            "SELECT COALESCE(MAX(turn), 0) AS value FROM messages WHERE session_id=?",
            (session_id,),
        ).fetchone()
        return int(row["value"]) + 1

    def save_message(self, msg: MessageRecord) -> int:
        self.get_session(msg.session_id)
        cursor = self._connection().execute(
            """INSERT INTO messages
               (session_id, turn, role, model, attempt, memory_on, is_final, content, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                msg.session_id,
                msg.turn,
                msg.role,
                msg.model,
                msg.attempt,
                int(msg.memory_on),
                int(msg.is_final),
                msg.content,
                msg.created_at.isoformat(),
            ),
        )
        return int(cursor.lastrowid)

    def set_final(self, session_id: str, turn: int, message_id: int) -> None:
        connection = self._connection()
        row = connection.execute(
            "SELECT role FROM messages WHERE id=? AND session_id=? AND turn=?",
            (message_id, session_id, turn),
        ).fetchone()
        if row is None or row["role"] != "assistant":
            raise KeyError(message_id)
        connection.execute("BEGIN IMMEDIATE")
        try:
            connection.execute(
                "UPDATE messages SET is_final=0 WHERE session_id=? AND turn=? AND role='assistant'",
                (session_id, turn),
            )
            connection.execute("UPDATE messages SET is_final=1 WHERE id=?", (message_id,))
            connection.execute("COMMIT")
        except sqlite3.Error:
            connection.execute("ROLLBACK")
            raise

    def messages(self, session_id: str) -> list[MessageRecord]:
        self.get_session(session_id)
        rows = self._connection().execute(
            "SELECT * FROM messages WHERE session_id=? ORDER BY turn, id", (session_id,)
        ).fetchall()
        return [self._message(row) for row in rows]

    def save_verifications(self, message_id: int, results: Sequence[CheckResult]) -> None:
        connection = self._connection()
        if connection.execute("SELECT 1 FROM messages WHERE id=?", (message_id,)).fetchone() is None:
            raise KeyError(message_id)
        connection.execute("BEGIN IMMEDIATE")
        try:
            connection.execute("DELETE FROM verifications WHERE message_id=?", (message_id,))
            connection.executemany(
                "INSERT INTO verifications VALUES (?, ?, ?, ?)",
                [
                    (message_id, result.check_id.value, result.status, result.evidence)
                    for result in results
                ],
            )
            connection.execute("COMMIT")
        except sqlite3.Error:
            connection.execute("ROLLBACK")
            raise

    def verifications(self, message_id: int) -> list[CheckResult]:
        if self._connection().execute("SELECT 1 FROM messages WHERE id=?", (message_id,)).fetchone() is None:
            raise KeyError(message_id)
        rows = self._connection().execute(
            "SELECT * FROM verifications WHERE message_id=? ORDER BY check_id", (message_id,)
        ).fetchall()
        return [
            CheckResult(check_id=CheckId(row["check_id"]), status=row["status"], evidence=row["evidence"])
            for row in rows
        ]

    @staticmethod
    def _item_values(item: Item) -> tuple[object, ...]:
        return (
            item.id,
            item.kind.value,
            item.text,
            item.reason,
            json.dumps(item.aliases),
            item.check_id.value if item.check_id else None,
            item.supersedes,
            item.session_id,
            item.project,
            item.user,
            item.turn,
            item.model,
            item.source,
            item.created_at.isoformat(),
        )

    def _validate_item_sessions(self, items: Sequence[Item]) -> None:
        for session_id in {item.session_id for item in items}:
            self.get_session(session_id)

    def add_items(self, items: Sequence[Item]) -> None:
        if not items:
            return
        self._validate_item_sessions(items)
        self._connection().executemany(
            """INSERT OR REPLACE INTO contract_items
               (id, kind, text, reason, aliases_json, check_id, supersedes,
                session_id, project, user, turn, model, source, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [self._item_values(item) for item in items],
        )

    def replace_turn_items(self, session_id: str, turn: int, items: Sequence[Item]) -> None:
        self.get_session(session_id)
        if any(item.session_id != session_id or item.turn != turn for item in items):
            raise ValueError("replacement items must belong to the requested session and turn")
        connection = self._connection()
        connection.execute("BEGIN IMMEDIATE")
        try:
            connection.execute(
                "DELETE FROM contract_items WHERE session_id=? AND turn=?", (session_id, turn)
            )
            connection.executemany(
                """INSERT INTO contract_items
                   (id, kind, text, reason, aliases_json, check_id, supersedes,
                    session_id, project, user, turn, model, source, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                [self._item_values(item) for item in items],
            )
            connection.execute("COMMIT")
        except sqlite3.Error:
            connection.execute("ROLLBACK")
            raise

    def items(self, session_id: str) -> list[Item]:
        self.get_session(session_id)
        rows = self._connection().execute(
            "SELECT * FROM contract_items WHERE session_id=? ORDER BY turn, created_at, id",
            (session_id,),
        ).fetchall()
        return [self._item(row) for row in rows]

    def project_items(self, project: str) -> list[Item]:
        rows = self._connection().execute(
            "SELECT * FROM contract_items WHERE project=? ORDER BY created_at, turn, id", (project,)
        ).fetchall()
        return [self._item(row) for row in rows]

    def bridge_session(self, project: str, app: str) -> SessionRecord:
        if app not in ("chatgpt", "claude"):
            raise ValueError("Unknown bridge app")
        connection = self._connection()
        connection.execute("BEGIN IMMEDIATE")
        try:
            row = connection.execute(
                "SELECT session_id FROM bridge_sessions WHERE project=? AND app=?", (project, app)
            ).fetchone()
            if row:
                record = self.get_session(row["session_id"])
            else:
                user = "ChatGPT" if app == "chatgpt" else "Claude"
                existing = connection.execute(
                    "SELECT * FROM sessions WHERE project=? AND user=? ORDER BY created_at, id LIMIT 1",
                    (project, user),
                ).fetchone()
                record = self._session(existing) if existing else self.create_session(project, user, True)
                last_turn = max(self.next_turn(record.id) - 1,
                                max((i.turn for i in self.items(record.id)), default=0))
                connection.execute("INSERT INTO bridge_sessions VALUES (?, ?, ?, ?)",
                                   (project, app, record.id, last_turn))
            connection.execute("COMMIT")
            return record
        except Exception:
            connection.execute("ROLLBACK")
            raise

    def reserve_bridge_turn(self, session_id: str) -> int:
        row = self._connection().execute(
            "UPDATE bridge_sessions SET last_turn=last_turn+1 WHERE session_id=? RETURNING last_turn",
            (session_id,),
        ).fetchone()
        if row is None:
            raise KeyError(session_id)
        return int(row["last_turn"])

    def log_bridge_event(self, event: BridgeEvent) -> None:
        self._connection().execute(
            "INSERT INTO bridge_events(project, at, app, action, summary, items, passed) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (event.project, event.at.isoformat(), event.app, event.action, event.summary,
             event.items, None if event.passed is None else int(event.passed)),
        )

    def bridge_events(self, project: str, limit: int = 50) -> list[BridgeEvent]:
        rows = self._connection().execute(
            "SELECT * FROM bridge_events WHERE project=? ORDER BY at DESC, id DESC LIMIT ?",
            (project, max(0, limit)),
        ).fetchall()
        return [BridgeEvent(at=_dt(row["at"]), project=row["project"], app=row["app"],
                            action=row["action"], summary=row["summary"], items=row["items"],
                            passed=None if row["passed"] is None else bool(row["passed"])) for row in rows]

    def bridge_activity(self, project: str) -> list[BridgeActivity]:
        rows = self._connection().execute(
            """SELECT app, MAX(at) AS last_seen,
               SUM(action='pull') AS pulls, SUM(action IN ('record', 'import')) AS records,
               SUM(action='check') AS checks FROM bridge_events
               WHERE project=? AND app IN ('chatgpt', 'claude') GROUP BY app""", (project,)
        ).fetchall()
        return [BridgeActivity(app=row["app"], last_seen=_dt(row["last_seen"]),
                               pulls=row["pulls"], records=row["records"], checks=row["checks"]) for row in rows]

    def log_handoff(self, session_id: str, turn: int, event: HandoffEvent) -> None:
        self.get_session(session_id)
        self._connection().execute(
            """INSERT INTO handoffs
               (session_id, turn, from_model, to_model, reason, retry_after, memories_recalled, at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                session_id,
                turn,
                event.from_model,
                event.to_model,
                event.reason,
                event.retry_after,
                event.memories_recalled,
                event.at.isoformat(),
            ),
        )

    def handoffs(self, session_id: str) -> list[tuple[int, HandoffEvent]]:
        self.get_session(session_id)
        rows = self._connection().execute(
            "SELECT * FROM handoffs WHERE session_id=? ORDER BY turn, id", (session_id,)
        ).fetchall()
        return [
            (
                row["turn"],
                HandoffEvent(
                    from_model=row["from_model"],
                    to_model=row["to_model"],
                    reason=row["reason"],
                    retry_after=row["retry_after"],
                    memories_recalled=row["memories_recalled"],
                    at=_dt(row["at"]),
                ),
            )
            for row in rows
        ]

    def save_recall(self, session_id: str, turn: int, trace: RecallTrace) -> None:
        self.get_session(session_id)
        self._connection().execute(
            """INSERT INTO recalls
               (session_id, turn, purpose, query, tags_json, result_count, latency_ms, error)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                session_id,
                turn,
                trace.purpose,
                trace.query,
                json.dumps(trace.tags),
                trace.result_count,
                trace.latency_ms,
                trace.error,
            ),
        )

    def recalls(self, session_id: str) -> list[RecallTrace]:
        self.get_session(session_id)
        row = self._connection().execute(
            "SELECT MAX(turn) AS value FROM recalls WHERE session_id=?", (session_id,)
        ).fetchone()
        if row["value"] is None:
            return []
        rows = self._connection().execute(
            "SELECT * FROM recalls WHERE session_id=? AND turn=? ORDER BY id",
            (session_id, row["value"]),
        ).fetchall()
        return [
            RecallTrace(
                purpose=row["purpose"],
                query=row["query"],
                tags=tuple(json.loads(row["tags_json"])),
                result_count=row["result_count"],
                latency_ms=row["latency_ms"],
                error=row["error"],
            )
            for row in rows
        ]
