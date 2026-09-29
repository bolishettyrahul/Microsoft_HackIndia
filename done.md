# Baton: progress so far

Last updated 2026-09-29 after the backend implementation milestone. Submission is due at about 00:15 IST on 2026-09-30.

## Decisions

| Decision | Choice |
| --- | --- |
| How the work is split | Three sectors: **AI**, **backend**, **frontend**, with one handoff contract per boundary |
| UI stack | **React** (Vite + Tailwind) for the frontend, talking to a **FastAPI** backend over HTTP (`/api`) |
| Who builds | Three background agents, one per sector worktree; integration happens on `main` |
| Process | Deadline mode: contracts first, then a parallel build. The specs' full gate process is suspended. |
| Worktree setup | Each worktree gets a sector brief (the root `CLAUDE.md`), file fences (`.claude/settings.local.json` deny rules) and its own environment (`.venv`, `.env`) |

## Done

1. **Specs regrouped into three sectors.** The design spec and the sectors doc now describe AI, backend and frontend (commit `b2121ec`, now on `main`).
2. **Contracts written on `main`:**
   - `baton/interfaces/types.py` holds the shared types: items, preferences, alerts, handoff events, recall traces and extractor output.
   - `baton/interfaces/errors.py` holds `RateLimited` and `ModelUnavailable`, the only errors that cross from AI to backend.
   - `baton/interfaces/ai.py` is the **AI → backend** contract: `ChatModel`, `ModelChain`, `Extractor`, `Store` (SQLite L1), `LongTermMemory` (Hindsight L2), and the `AIServices` bundle.
   - `baton/interfaces/api.py` is the **backend → frontend** contract: 17 HTTP endpoints and their JSON views. `web/src/api/contract.ts` mirrors it in TypeScript.
   - `baton/config.py` reads settings from `.env`.
   - Project files: `requirements.txt`, `.env.example`, `pyproject.toml` and `.gitignore`.
   - The root `CLAUDE.md` maps each branch to its sector, lists the files each sector owns, and sets the cut-down scope.
3. **Worktrees & Branches:** `frontend` worktree exists at `.claude/worktrees/frontend` (fast-forwarded to `main`). Branches `worktree-ai`, `worktree-backend`, `worktree-frontend` (and convenience aliases `ai`, `backend`, `frontend`) have been created at `18f126f` and pushed to remote `origin`.
4. **Backend implemented on the `backend` branch** in commit `37cab26` (`Build Baton backend API and turn orchestration`):
   - `baton/backend/contract.py` merges L1 and L2 items, applies supersession and caps, resolves reversal targets, validates rejection aliases, renders the copyable `<baton_contract>` block, and builds the rejection ledger.
   - `baton/backend/redact.py` redacts Groq, OpenAI/Anthropic, Google, GitHub, AWS and JWT credentials, `.env`-style secrets, and email addresses before storage or retention.
   - `baton/backend/verifier.py` implements the deterministic `rejected`, `continuity` and `no_bullets` checks, including rejection-negation handling and ignoring fenced code for list detection.
   - `baton/backend/compose.py` builds memory-ON and memory-OFF prompts, applies repair rules, and strips leaked `<think>` reasoning blocks.
   - `baton/backend/turn.py` implements the turn loop: model candidates, 429/unavailable handoffs, sticky active model, one repair retry, message and verification storage, extraction, item creation, reversal/resolution matching, retain calls, no-model fallback, and last-turn re-runs.
   - `baton/backend/facade.py` implements the backend facade for sessions, turns, model selection/switching, burst, contract, ledger reversal, and memory trace views.
   - `baton/backend/app.py` exposes all 17 contracted operations under `/api`; `baton/backend/wiring.py` is the single permitted integration point for `build_ai`.
   - `tests/backend/` contains deterministic fake AI services plus engine and HTTP integration tests. Current result: **7 tests passed** with no network or API keys.

## Backend status and handoff

The backend is **complete against fake AI services**, but it has not yet been proven against the real AI sector. Do not describe it as live-integrated until the AI branch is merged and the checks below pass.

### Backend behavior already covered

- All 17 backend-to-frontend API operations exist.
- A 429 cools the failing model and hands the turn to the next candidate.
- A manual switch benches the active model for that session and refreshes memory.
- Memory ON injects the Baton contract and permits one repair; memory OFF uses neutral, model-specific history and does not repair.
- The last turn can be re-run with the opposite memory setting while preserving the earlier reply.
- Extracted items update the contract and rejection ledger; reversals supersede their matched rejection.
- Empty handoff memory and no available model produce typed alerts instead of silent fallbacks.
- Copy Baton output and stored messages/items are redacted.

### Backend work still required before integration is complete

1. Merge the AI sector so `baton/ai/build.py`, the real model chain, SQLite store, extractor and Hindsight implementation are available. `baton/ai` is not present on the backend branch at this checkpoint.
2. Run the FastAPI backend with the real `AIServices` bundle and test it through the React frontend.
3. Rebuild `GET /api/sessions/{sid}/turns` from SQLite after a process restart. The current facade keeps completed `TurnView` objects in process memory.
4. Persist recall traces through `Store.save_recall()` so Memory Trace history remains reliable across requests and restarts.
5. Add a durable retain outbox/retry path so a failed Hindsight retain is retried after a crash or restart.
6. Add scenario coverage for memory OFF, manual switching, no model available, LTM timeout/failure, extraction failure, unmatched reversal, and end-to-end proof that redacted values—not secrets—reach SQLite and Hindsight.

### Backend verification command

From the repository root, run:

```powershell
python -m pytest -q tests/backend
```

Expected result at commit `37cab26`: `7 passed`.

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

**Out:** the patch statistics and learning chart, seeding, the team view, "Why?", Ollama, and the full conformance suites.

## Next

1. Create the `ai` and `backend` worktrees (`worktree-ai` and `worktree-backend`, from `main`), and write the file fences in all three.
2. Start the three agents:
   - **AI:** Groq and Gemini provider, model chain and cooldowns, burst, extractor, SQLite store, Hindsight, and `build_ai`.
   - **Backend:** core implementation is done against fake AI at `37cab26`; complete the six integration and persistence items in **Backend status and handoff** above.
   - **Frontend:** the React UI against a mock API, with a Vite proxy to `:8000`.
3. Meanwhile, on `main`: the README, and drafts of the video script and posts.
4. Around 23:30: merge the sectors into `main`, run the live integration with real keys, and fix what breaks.
5. Around 23:55: push, record the demo, submit.

## Needed from you

- Pause OneDrive syncing. Otherwise it fights `node_modules`, `.venv` and SQLite.
- Create `R_D\.env` from `.env.example` with `GROQ_API_KEY`, `GEMINI_API_KEY` and `HINDSIGHT_API_KEY`. Never commit it.
