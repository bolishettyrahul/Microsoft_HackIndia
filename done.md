# Baton: completed work

Last updated: 2026-09-30. Scope: the local checkout and backend work from `planv2.md`.

**Backend B1-B5 are implemented and tested. B6 has passed a localhost MCP transport
check, but real app connection is not complete.** Remaining work is tracked in
[not_done.md](not_done.md). No commits or pushes were made during these changes.

## Existing project foundation

The earlier progress report recorded the initial AI, backend and frontend build.
Those existing components include:

- Shared typed contracts, settings, provider errors and sector documentation.
- Groq/Gemini adapters, model routing, structured extraction, SQLite storage and
  Hindsight integration code.
- Contract merging, rejection ledger, deterministic verification, prompt
  composition, redaction, model handoff and the original 17 HTTP endpoints.
- React landing page and in-app workspace, with mock and HTTP clients.

These are implementation records, not proof of live provider operation. Historical
branch/commit and frontend test claims were not reverified in this backend pass.
Frontend files and model-provider adapters were not changed.

## Backend plan v2

| Item | Completed work | Evidence |
| --- | --- | --- |
| B1: fake mode | Verified that `BATON_AI=fake` uses backend-owned fake services without provider keys | `baton/backend/wiring.py`, `fake_ai.py`, `tests/backend/test_api.py` |
| B1: provider failures | Auth failures disable; transient errors cool down for 30 seconds; bad requests skip without global disabling. Policy applies to initial and repair calls; provider diagnostics are redacted | `baton/backend/turn.py`, regression tests |
| B1: transcript recovery | Restores final replies, earlier attempts, handoffs and check chips from stored records; chip ordering remains consistent after restart | `baton/backend/facade.py`, SQLite reopening integration test |
| B1: rerun continuity | Current-turn replies do not suppress the first-reply continuity check on rerun | Backend and HTTP integration regressions |
| B2: HTTP integration | Tests all 17 original endpoints, scripted 429 handoff, repair, memory-off rerun, burst, 404 and 422 | `tests/integration/test_http_flow.py` |
| B3: bridge service | Project-wide pull, typed item recording, exchange extraction/import, draft checks, rejection ledger, app activity and event timeline | `baton/backend/bridge.py`, `tests/backend/test_bridge.py` |
| B3: shared extraction | One reusable item builder for chat and bridge, including target resolution, provenance, preferences, aliases and redaction | `baton/backend/extraction.py`, `tests/backend/test_extraction.py` |
| B4: MCP tools | Separate ChatGPT and Claude FastMCP servers, each exposing all five tools over Streamable HTTP; server lifecycles managed by FastAPI | `baton/backend/mcp_server.py`, `tests/backend/test_mcp.py` |
| B5: bridge HTTP API | Three typed endpoints and generated connection URLs/configuration | `baton/backend/app.py`, `bridge_setup.py` |
| B6: connection tooling | Config merge helper preserves other Claude settings and creates a backup; separate MCP-only listener for tunnelling | `baton/backend/connect_claude.py`, `serve.py` |

The five MCP tools are `pull_baton`, `record_items`, `record_exchange`,
`check_reply` and `get_ledger`.

The three added HTTP endpoints are:

- `GET /api/projects/{project}/bridge`
- `GET /api/bridge/setup`
- `POST /api/projects/{project}/import`

## Shared prerequisites implemented with the backend

The follow-up request authorized completing the missing backend prerequisites
without waiting for another sector:

- Contract version `2h-2.0`, bridge event/activity models and HTTP request/response types.
- Store protocol additions and matching SQLite/fake-store implementations.
- Durable external sessions per project/app, project-wide item reads and bridge events.
- Atomic bridge turn reservation, including empty extraction results, so later
  retains do not reuse the same document id.
- All-time app activity counts independent of the latest 50 timeline events.
- MCP dependency in `requirements.txt`, installed in the project virtual environment.
- `BATON_MCP_TOKEN` and `BATON_PUBLIC_URL` settings and environment examples.
- Random process token when none is configured, URL validation, MCP host/origin
  checks and a public listener that excludes management/setup routes.

The frontend TypeScript contract was not updated in this backend pass; its v2
integration remains frontend/integration-owner work.

## Verification completed

**Last full offline test run: 45 passed.** `git diff --check` also passed.

Coverage includes backend regressions, existing AI unit tests, HTTP integration,
bridge operations, all five tools, SDK in-memory transport, mounted Streamable
HTTP transport, validation, incorrect tokens, untrusted hosts/origins, config
merging, SQLite reopening, concurrent session/turn allocation and activity beyond
50 events.

A separate running-server test used the real MCP SDK against localhost ports
8010/8011. The SDK called the ChatGPT endpoint to record Redis as rejected, then
called the Claude endpoint to pull the contract and check a Redis suggestion.
The check failed as expected and the timeline contained record, pull and check
events. Management/setup routes returned 404 on the MCP-only listener.

**That test used fake AI and explicitly supplied items.** It proves transport and
backend behavior, not calls from the actual ChatGPT/Claude apps, live provider
extraction or Hindsight retention. Frontend tests/build were not run in this pass.

## Handoff

See [backend setup and detailed evidence](baton/backend/PLAN_V2_HANDOFF.md).
Start the backend with the project environment:

```powershell
.\.venv\Scripts\python.exe -m baton.backend.serve
```

Default ports: local management/API on 8000, MCP-only tunnel listener on 8001.
Use one backend worker for this prototype. The remaining acceptance checks and
known limitations are in [not_done.md](not_done.md).
