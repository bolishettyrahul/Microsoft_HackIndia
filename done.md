# Baton: progress so far

Last updated 2026-09-30, 01:30 IST. Current delivery target: 09:00 IST on 2026-09-30.

## AI plan v3 update

The AI-owned work from `planv2.md` and `planv3.md` is implemented. The shared additive v3 contract is also ready for the backend and frontend consumers.

1. **Contracts v3 (`2h-3.0`):** added the bridge, learning, patch-stat, extra-check, and grounded-why types in Python and TypeScript. Configuration now includes the optional OpenAI key and bridge settings.
2. **A1/A8 — live provider verification:** all six real-service tests pass. The latest run measured Groq `gpt-oss-120b` at 483 ms, Gemini 3.5 Flash at 1,738 ms, Qwen at 504 ms, and Hindsight retain-to-recall at 5.84 s. Both extractor models returned a Redis rejection with a reason. Hindsight reflection returned an answer grounded in eight sources. Detailed observations are in `docs/research/2026-09-30-live-findings.md`.
3. **A2 — safe Hindsight fallback:** startup, recall, retain, timeout, unavailable-service, and no-credit paths remain outside the app's failure path. `why()` also returns a visible error object and never raises.
4. **A3 — bridge persistence:** SQLite now exposes project-wide contract items across sessions and persists ordered bridge events.
5. **A4 — OpenAI seam:** `openai:<model>` uses the native OpenAI-compatible endpoint and is visibly disabled with `OPENAI_API_KEY is not configured` when the optional key is absent.
6. **A6 — model learning persistence:** SQLite upserts pass/trial totals by model, check, and patch level. First-attempt rates exclude repair attempts, memory-OFF attempts, and `n/a` checks.
7. **A7 — grounded rejection explanations:** Hindsight `reflect` answers “Why did the team reject this?” with the required tags, low budget, 20-second timeout, and source ids.
8. **Verification:** `23 passed` in `tests/ai`; the complete offline suite is `30 passed, 6 deselected`; `pytest -m live tests/live` is `6 passed`; `compileall` and `pip check` are clean.

**A5 support remains active:** rerun the live suite once more after every sector has been merged into `main`, and investigate any provider failure seen during the final rehearsal.

## Decisions

| Decision | Choice |
| --- | --- |
| How the work is split | Three sectors: **AI**, **backend**, **frontend**, with one handoff contract per boundary |
| UI stack | **React 19** (Vite + Tailwind v4) for the frontend, talking to a **FastAPI** backend over HTTP (`/api`) |
| Who builds | Three background agents, one per sector worktree; integration happens on `main` |
| Process | Deadline mode: contracts first, then a parallel build. The specs' full gate process is suspended. |
| Worktree setup | Each worktree gets a sector brief (the root `CLAUDE.md`), file fences (`.claude/settings.local.json` deny rules) and its own environment (`.venv`, `.env`) |

## Done

1. **Specs regrouped into three sectors.** The design spec and the sectors doc now describe AI, backend and frontend (commit `b2121ec`, on `main`).
2. **Contracts written on `main`:**
   - `baton/interfaces/types.py` holds shared types: items, preferences, alerts, handoff events, recall traces and extractor output.
   - `baton/interfaces/errors.py` holds `RateLimited` and `ModelUnavailable`, the only errors crossing AI to backend.
   - `baton/interfaces/ai.py` is the **AI → backend** contract: `ChatModel`, `ModelChain`, `Extractor`, `Store` (SQLite L1), `LongTermMemory` (Hindsight L2), and `AIServices`.
   - `baton/interfaces/api.py` is the **backend → frontend** contract: 17 HTTP endpoints and their JSON views. `web/src/api/contract.ts` mirrors it in TypeScript.
   - `baton/config.py` reads settings from `.env`.
   - Project files: `requirements.txt`, `.env.example`, `pyproject.toml` and `.gitignore`.
   - The root `CLAUDE.md` maps each branch to its sector, lists the files each sector owns, and sets the cut-down scope.
3. **Worktrees & Branches:** Branches `worktree-ai`, `worktree-backend`, `worktree-frontend` (and aliases `ai`, `backend`, `frontend`) created, tracked, and synchronized.
4. **AI sector implemented and pushed (`ai` branch, commit `c9956d3` / `902af55`):**
   - `baton/ai/provider.py`: OpenAI-compatible Groq and Gemini adapter, SDK retries disabled, reasoning blocks stripped, provider errors mapped to `RateLimited` / `ModelUnavailable`.
   - `baton/ai/chain.py`: Sticky per-session model selection, session-only benching, global cooldowns, status reporting, and Groq-only rate-limit burst.
   - `baton/ai/extractor.py`: Strict structured extraction, validation retry, provider fallback, alias normalization, and visible extraction-failure alerts.
   - `baton/ai/store.py`: Thread-safe SQLite L1 store with per-thread connections, WAL mode, sessions, messages, final attempts, checks, items, handoffs, and recall traces.
   - `baton/ai/hindsight.py`: Dedicated Hindsight event-loop thread, bank setup/directives, fire-and-forget retain, parallel recall, metadata item reconstruction, timeouts, and no-credit alerts.
   - `baton/ai/build.py`: Exposes `build_ai(settings) -> AIServices` with fallback L1-only states when keys are absent.
   - **Verification:** 13 unit tests passed (`pytest tests/ai`), clean `compileall` and `pip check`.
5. **Backend sector implemented and pushed (`backend` branch, commit `37cab26` / `ad4d4eb`):**
   - `baton/backend/contract.py`: Merges L1 and L2 items, applies supersession/caps, resolves reversal targets, validates rejection aliases, renders `<baton_contract>`, and builds rejection ledger.
   - `baton/backend/redact.py`: Redacts Groq, OpenAI/Anthropic, Google, GitHub, AWS, and JWT credentials, `.env` secrets, and emails.
   - `baton/backend/verifier.py`: Deterministic `rejected`, `continuity`, and `no_bullets` checks with negation awareness and code-fence ignoring.
   - `baton/backend/compose.py`: Builds memory-ON/OFF prompts, repair rules, and strips leaked `<think>` tags.
   - `baton/backend/turn.py`: Turn loop orchestration: model candidate selection, 429/unavailable handoff, sticky active model, repair retry, extraction/retain triggers, and memory-flipped turn re-runs.
   - `baton/backend/facade.py` & `baton/backend/app.py`: Implements backend facade and exposes all 17 API endpoints under `/api`.
   - `baton/backend/wiring.py`: Single integration point for `build_ai`.
   - **Verification:** 7 tests passed against deterministic fake AI (`pytest tests/backend`).
6. **Frontend sector implemented and pushed (`worktree-frontend` / `frontend`, commits `03bed65` through `e3b4a69`):**
   - **Stack & Architecture:** React 19, Vite, Tailwind CSS v4, TypeScript in `web/`.
   - **Design System ("Night Relay"):** Solid graphite surfaces, lane colors per model, baton gradient, self-hosted typography (Instrument Serif, Inter, JetBrains Mono), and reduced-motion support.
   - **API & Mock:** Fully typed HTTP client for all 17 endpoints (`web/src/api/http.ts`) and full-featured in-browser demo mock (`web/src/api/mock.ts`) with `npm run dev` (mock) and `npm run dev:live` (proxy to FastAPI on `:8000`).
   - **Landing Page (`/`):** Story scroll experience covering the 429 wall, Baton handoff, before/after comparison table, code check repair ladder, interactive 3D WebGL handoff hero (`react-three-fiber` scene with glowing spheres and baton particle trajectory), and a sticky scroll-driven 7-step turn-loop ring.
   - **Dashboard App (`/app`):** Slim top-bar relay showing model chain pills (active model with baton, cooling models with countdowns, click to switch), Memory toggle, Controls dropdown (Exhaust rate limit burst, Switch model, Refresh memory, No-bullets check), chat view with lane tags and check chips, and a right-hand Baton inspector panel (Goal, Next step, Rejected items, and Copy baton).
   - **Tests:** Vitest test suite (`web/src/__tests__/api.test.ts`) passing for mock states, request shapes, and lane rendering.

## Backend status and handoff

The backend is complete against deterministic fake AI services, but it is not considered live-integrated until the combined AI/backend/frontend application is exercised with real services.

Remaining backend and integration hardening:

1. Run FastAPI with the real `AIServices` bundle and verify it through the React live mode.
2. Rebuild `GET /api/sessions/{sid}/turns` from SQLite after process restart; completed `TurnView` objects are currently cached in process memory.
3. Persist recall traces through `Store.save_recall()` so Memory Trace history survives requests and restarts.
4. Add a durable retain outbox/retry path for failed Hindsight retains.
5. Add scenario coverage for memory OFF, manual switching, no available model, LTM failure, extraction failure, unmatched reversal, and proof that only redacted values reach SQLite and Hindsight.

Backend verification command: `python -m pytest -q tests/backend` (expected checkpoint result: `7 passed`).

## Scope for the submission

**In:**
- Chat on Model A (`gpt-oss-120b` on Groq), with a handoff to Gemini 3.5 Flash, then Qwen, on a 429 or a manual switch.
- The "Exhaust rate limit" burst.
- The extractor, which records goal, decisions, rejections and reversals, and next step.
- The contract injected into the system prompt.
- A memory ON/OFF toggle, and re-running the last turn with memory flipped.
- Checks: `rejected`, `continuity` and `no_bullets`, with one repair retry.
- Redaction.
- Hindsight retain and recall, falling back to SQLite only with an alert.
- Baton, Ledger and Memory trace tabs, and Copy baton.

**Now implemented in the AI layer:** bridge persistence, patch statistics, first-attempt learning points, the OpenAI provider seam, and grounded "Why?" reflection.

**Not yet integrated across every layer:** backend patch-level selection and learning/why endpoints, the learning chart, seeding, the team view, Ollama, and the full conformance suites.

## Tests remaining & Integration checklist

### AI live tests (requires API keys in `.env`)
- [x] Groq smoke calls for `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, and `qwen/qwen3.8-27b`.
- [x] Gemini smoke calls for `gemini-3.5-flash` and `gemini-3.5-flash-lite`, including strict structured output.
- [x] Create/ensure a Hindsight bank, retain typed items, recall tags and metadata intact, and reflect a grounded "Why?" answer.
- [x] Verify the dedicated event-loop thread and visible L1 fallback for startup failure, timeout, service failure, and HTTP 402.
- [ ] Intentionally trigger a real provider 429 and confirm its live `retry-after` value. Unit coverage passes; the live suite avoids spending the recording quota solely to cause failure.
- [ ] Run the Groq burst during the final rehearsal and confirm the model enters cooldown without exhausting the recording key.
- [ ] Rerun all six live tests after the final backend and frontend merge.

### Cross-sector integration tests
- [ ] Merge the remaining backend and frontend v3 work into `main` (the AI v3 work is ready).
- [ ] Run complete test suite (`pytest tests/ai tests/backend` + `npm test` in `web/`).
- [ ] Run FastAPI backend (`uvicorn baton.backend.app:app`) against real `AIServices` and verify live React UI (`npm run dev:live`).
- [ ] Verify end-to-end memory toggle (OFF -> fresh, ON -> contract injection, flip turn -> regenerated reply & items).
- [ ] Verify end-to-end extraction -> SQLite -> Hindsight retain -> handoff recall -> prompt injection.
- [ ] Verify rejected/continuity/no_bullets checks and 1-repair retry behavior on real models.
- [ ] Verify the extra checks, learned patch-level selection, learning endpoint/chart, and ledger "Why?" end to end.
- [ ] Drive the guided rail and learning tab with Playwright in fake-backend mode.
- [ ] Rehearse full demo path: Copy Baton, Ledger Reverse, Memory Trace, Burst Rate-Limit trigger.

## Next

1. Merge the AI v3 commit, then the remaining backend and frontend v3 branches into `main`.
2. Run cross-sector integration and fix any wiring issues against the already configured local keys.
3. Complete the bridge connection and UI rehearsal, then rerun the live AI suite.
4. Prepare README, record the demo video, and submit before 09:00 IST.

## Needed from you

- Pause OneDrive syncing if active. Otherwise it fights `node_modules`, `.venv` and SQLite.
- Keep the configured root `.env` local. Never commit or paste its API keys.
