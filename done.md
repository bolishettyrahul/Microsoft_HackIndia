# Baton: completed work

Last updated 2026-09-30, 01:53 IST. Current delivery target: 09:00 IST on 2026-09-30.

## AI plan v3 update

The AI-owned work from `planv2.md` and `planv3.md` is implemented. The shared additive v3 contract is also ready for the backend and frontend consumers.

1. **Contracts v3 (`2h-3.0`):** added the bridge, learning, patch-stat, extra-check, and grounded-why types in Python and TypeScript. Configuration now includes the optional OpenAI key and bridge settings.
2. **A1/A8 — live provider verification:** all six real-service tests pass. The post-backend-merge run measured Groq `gpt-oss-120b` at 786 ms, Gemini 3.5 Flash at 2,854 ms, Qwen at 204 ms, and Hindsight retain-to-recall at 6.67 s. Both extractor models returned a Redis rejection with a reason. Hindsight reflection returned an answer grounded in ten sources. Detailed observations are in `docs/research/2026-09-30-live-findings.md`.
3. **A2 — safe Hindsight fallback:** startup, recall, retain, timeout, unavailable-service, and no-credit paths remain outside the app's failure path. `why()` also returns a visible error object and never raises.
4. **A3 — bridge persistence:** SQLite now exposes project-wide contract items across sessions and persists ordered bridge events.
5. **A4 — OpenAI seam:** `openai:<model>` uses the native OpenAI-compatible endpoint and is visibly disabled with `OPENAI_API_KEY is not configured` when the optional key is absent.
6. **A6 — model learning persistence:** SQLite upserts pass/trial totals by model, check, and patch level. First-attempt rates exclude repair attempts, memory-OFF attempts, and `n/a` checks.
7. **A7 — grounded rejection explanations:** Hindsight `reflect` answers “Why did the team reject this?” with the required tags, low budget, 20-second timeout, and source ids.
8. **B9/B10 — learning and Why endpoints:** all 22 declared HTTP endpoints are now mounted. Learning returns patch statistics and project first-attempt points. Ledger Why validates the rejection, calls grounded reflection, and caches each answer until the ledger changes. The typed frontend HTTP client and mock expose both calls.
9. **Verification:** `23 passed` in `tests/ai`; the combined offline suite is `57 passed, 6 deselected`; `pytest -m live tests/live` is `6 passed`; frontend tests and the production build pass; `compileall` and `pip check` are clean.

**A5 support remains active:** rerun the live suite once more after every sector has been merged into `main`, and investigate any provider failure seen during the final rehearsal.

**Backend B1-B5 are implemented and tested. B6 has passed a localhost MCP transport
check, but real app connection is not complete.** Remaining work is tracked in
[not_done.md](not_done.md).

## Existing project foundation

The earlier progress report recorded the initial AI, backend and frontend build.
Those existing components include:

- Shared typed contracts, settings, provider errors and sector documentation.
- Groq/Gemini adapters, model routing, structured extraction, SQLite storage and
  Hindsight integration code.
- Contract merging, rejection ledger, deterministic verification, prompt
  composition, redaction, model handoff and the original 17 HTTP endpoints.
- React landing page and in-app workspace, with mock and HTTP clients.

These implementation records are now backed by the combined offline suite, the
frontend tests/build, and the separate six-test live-provider suite. A full live UI
walkthrough is still outstanding.

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

**Now implemented in the AI layer:** bridge persistence, patch statistics, first-attempt learning points, the OpenAI provider seam, and grounded "Why?" reflection.

**Not yet integrated across every layer:** backend patch-level selection, the learning/Why UI, seeding, the team view, Ollama, and the full conformance suites.

The follow-up request authorized completing the missing backend prerequisites
without waiting for another sector:

- Contract version `2h-3.0`, bridge event/activity models, learning models and HTTP request/response types.
- Store protocol additions and matching SQLite/fake-store implementations.
- Durable external sessions per project/app, project-wide item reads and bridge events.
- Atomic bridge turn reservation, including empty extraction results, so later
  retains do not reuse the same document id.
- All-time app activity counts independent of the latest 50 timeline events.
- MCP dependency in `requirements.txt`, installed in the project virtual environment.
- `BATON_MCP_TOKEN` and `BATON_PUBLIC_URL` settings and environment examples.
- Random process token when none is configured, URL validation, MCP host/origin
  checks and a public listener that excludes management/setup routes.

## Tests remaining

### AI live tests (requires API keys in `.env`)
- [x] Groq smoke calls for `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, and `qwen/qwen3.8-27b`.
- [x] Gemini smoke calls for `gemini-3.5-flash` and `gemini-3.5-flash-lite`, including strict structured output.
- [x] Create/ensure a Hindsight bank, retain typed items, recall tags and metadata intact, and reflect a grounded "Why?" answer.
- [x] Verify the dedicated event-loop thread and visible L1 fallback for startup failure, timeout, service failure, and HTTP 402.
- [ ] Intentionally trigger a real provider 429 and confirm its live `retry-after` value. Unit coverage passes; the live suite avoids spending the recording quota solely to cause failure.
- [ ] Run the Groq burst during the final rehearsal and confirm the model enters cooldown without exhausting the recording key.
- [ ] Rerun all six live tests after the final backend and frontend merge.

### Cross-sector integration tests
- [ ] Merge the remaining frontend v3 work into `main` (AI v3 and backend v2 are merged locally).
- [x] Run the combined Python suite, frontend tests, and frontend production build.
- [ ] Run FastAPI backend (`uvicorn baton.backend.app:app`) against real `AIServices` and verify live React UI (`npm run dev:live`).
- [ ] Verify end-to-end memory toggle (OFF -> fresh, ON -> contract injection, flip turn -> regenerated reply & items).
- [ ] Verify end-to-end extraction -> SQLite -> Hindsight retain -> handoff recall -> prompt injection.
- [ ] Verify rejected/continuity/no_bullets checks and 1-repair retry behavior on real models.
- [x] Verify the learning and ledger Why HTTP endpoints with fake services and real SQLite/store classes.
- [ ] Verify the extra checks, learned patch-level selection, learning chart, and ledger Why UI end to end.
- [ ] Drive the guided rail and learning tab with Playwright in fake-backend mode.
- [ ] Rehearse full demo path: Copy Baton, Ledger Reverse, Memory Trace, Burst Rate-Limit trigger.

## Verification completed

**Last full offline test run: 57 passed, 6 live tests deselected.** The frontend has
`5 passed`, its production build succeeds, and `git diff --check` passes.

## Next steps

1. Finish this merge and push it, then merge the remaining frontend v3 branch into `main`.
2. Run the live FastAPI/React walkthrough against the already configured local keys.
3. Complete the real app bridge connection and UI rehearsal, then rerun the live AI suite.
4. Prepare README, record the demo video, and submit before 09:00 IST.

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

- Pause OneDrive syncing if active. Otherwise it fights `node_modules`, `.venv` and SQLite.
- Keep the configured root `.env` local. Never commit or paste its API keys.

**That transport test used fake AI and explicitly supplied items.** It proves
transport and backend behavior, not calls from the actual ChatGPT/Claude apps.
Live provider extraction and Hindsight retention/reflection pass separately.

## Handoff

See [backend setup and detailed evidence](baton/backend/PLAN_V2_HANDOFF.md).
Start the backend with the project environment:

```powershell
.\.venv\Scripts\python.exe -m baton.backend.serve
```

Default ports: local management/API on 8000, MCP-only tunnel listener on 8001.
Use one backend worker for this prototype. The remaining acceptance checks and
known limitations are in [not_done.md](not_done.md).
