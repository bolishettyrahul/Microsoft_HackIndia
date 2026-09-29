# Baton: progress so far

Last updated 2026-09-29, 23:22 IST. Submission is due at about 00:15 IST on 2026-09-30.

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
4. **AI sector implemented and pushed:** commit `c9956d3` is on the remote `ai` branch.
   - `baton/ai/provider.py` implements the OpenAI-compatible Groq and Gemini adapter, disables SDK retries, strips reasoning blocks, and maps provider failures to `RateLimited` or `ModelUnavailable`.
   - `baton/ai/chain.py` implements sticky per-session model selection, session-only benching, global cooldowns and disables, status reporting, and the Groq-only rate-limit burst.
   - `baton/ai/extractor.py` implements strict structured extraction, one validation retry, provider fallback, alias normalization, and visible extraction-failure alerts.
   - `baton/ai/store.py` implements the thread-safe SQLite L1 store with one connection per thread, WAL mode, sessions, messages, final attempts, checks, items, handoffs, and recall traces.
   - `baton/ai/hindsight.py` implements the dedicated Hindsight event-loop thread, bank setup and directives, fire-and-forget retain, parallel state/ledger recall, metadata-based item reconstruction, timeouts, and no-credit alerts.
   - `baton/ai/build.py` exposes `build_ai(settings) -> AIServices` and creates visible disabled/L1-only states when keys are absent.
5. **AI offline verification passed:** `13 passed` under `tests/ai`, `compileall` succeeds, `pip check` reports no broken dependencies, and `git diff --check` is clean. The tests cover provider request shaping and reasoning removal; chain order, cooldown expiry, benching and burst; extractor schema/retry/failure; SQLite round trips and cross-thread access; Hindsight retain/recall, 402 and timeout behavior; and offline service construction.

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

## Tests remaining

### AI live tests (blocked until the three `.env` keys contain values)

- [ ] Groq smoke calls for `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, and `qwen/qwen3.8-27b`.
- [ ] Gemini smoke calls for `gemini-3.5-flash` and `gemini-3.5-flash-lite`, including strict structured output.
- [ ] Verify real 429 parsing and `retry-after` behavior for Groq and Gemini.
- [ ] Run the Groq burst once and confirm the model enters cooldown without exhausting the demo-day quota.
- [ ] Create/ensure the Hindsight project bank, retain one typed turn, and recall it with tags and metadata intact.
- [ ] Confirm the real Hindsight client works on the dedicated event-loop thread and that a failed/slow recall returns the visible L1-only alert.

### Cross-sector integration tests

- [ ] Merge AI, backend and frontend branches into `main`, resolving only integration issues.
- [ ] Run the complete offline `pytest` suite after the merge.
- [ ] Exercise `build_ai` through the real FastAPI backend: normal chat, manual handoff, 429 handoff, sticky target model, and no-model fallback.
- [ ] Verify memory OFF starts fresh; memory ON injects the contract; re-running with memory flipped replaces the turn's final reply and extracted items.
- [ ] Verify extraction -> SQLite -> Hindsight retain -> handoff recall -> contract injection end to end.
- [ ] Verify rejected, continuity and no-bullets checks plus the single repair retry through the real model chain.
- [ ] Verify missing/bad keys, Hindsight timeout/no credits, extraction failure, and provider auth/bad-request failures are visible in the API and UI.
- [ ] Run the React production build and rehearse the full demo path with Copy baton, Ledger and Memory trace.

## Next

1. Fill the existing root `.env` with `GROQ_API_KEY`, `GEMINI_API_KEY` and `HINDSIGHT_API_KEY`; the variables currently exist but their values are empty.
2. Run the six AI live-test groups above, using only minimal smoke calls until the final burst rehearsal.
3. Finish and push the backend and frontend sectors.
4. Merge all three sectors into `main`, run the cross-sector tests, and fix integration failures.
5. Finish the README and submission content, rehearse the demo, record it, and submit.

## Needed from you

- Pause OneDrive syncing. Otherwise it fights `node_modules`, `.venv` and SQLite.
- Fill the existing root `.env` with `GROQ_API_KEY`, `GEMINI_API_KEY` and `HINDSIGHT_API_KEY`. Never commit it or paste the values into chat.
