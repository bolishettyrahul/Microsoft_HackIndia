# Baton: progress so far

Last updated 2026-09-29, 22:30 IST. Submission is due at about 00:15 IST on 2026-09-30.

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
3. **Worktrees:** `frontend` already exists at `.claude/worktrees/frontend`. It was locked by an earlier Claude session that had stopped, so the lock is released as part of this commit.

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
   - **Backend:** engine (contract, verifier, redaction, prompt composition), turn loop, and the FastAPI app, built against a fake AI.
   - **Frontend:** the React UI against a mock API, with a Vite proxy to `:8000`.
3. Meanwhile, on `main`: the README, and drafts of the video script and posts.
4. Around 23:30: merge the sectors into `main`, run the live integration with real keys, and fix what breaks.
5. Around 23:55: push, record the demo, submit.

## Needed from you

- Pause OneDrive syncing. Otherwise it fights `node_modules`, `.venv` and SQLite.
- Create `R_D\.env` from `.env.example` with `GROQ_API_KEY`, `GEMINI_API_KEY` and `HINDSIGHT_API_KEY`. Never commit it.
