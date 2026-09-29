# Baton

Baton keeps a software task going when you switch AI models. After every turn it records the task state (goal, decisions, rejected approaches with reasons, next step) as a typed contract. When a model hits a 429 or is switched out, the next model gets the contract instead of the transcript. Code checks every reply against the contract.

- Full design: `docs/superpowers/specs/2026-09-29-baton-design.md`. Sector rules: `docs/superpowers/specs/2026-09-29-baton-sectors-and-contracts.md`. API facts: `docs/research/2026-09-29-api-research.md`.
- **Deadline mode (submit ~00:15 IST 2026-09-30).** The specs' full process (gates, fakes and conformance suites for every protocol) is suspended. Build the scope below, keep tests small and useful, and don't gold-plate.

## Which sector am I?

Check the current branch (`git branch --show-current`):

| Branch | Sector | You may edit | You must not edit |
| --- | --- | --- | --- |
| `worktree-ai` | AI | `baton/ai/**`, `tests/ai/**` | everything else |
| `worktree-backend` | Backend | `baton/backend/**`, `tests/backend/**` | everything else |
| `worktree-frontend` | Frontend | `web/**` except `web/src/api/contract.ts` | everything else |
| `main` | Integration | contracts, config, docs, README | sector code, except integration fixes |

**The contracts are owned by `main`:** `baton/interfaces/**`, `baton/config.py`, `web/src/api/contract.ts`, `requirements.txt`, `.env.example`, `.gitignore`, `pyproject.toml`, `CLAUDE.md`, `docs/**`. If a contract is wrong, stop and report it; don't patch it on your branch.

```text
web/ (React) --HTTP /api--> baton/backend/ (FastAPI + turn loop) --AIServices--> baton/ai/ --> Groq, Gemini, SQLite, Hindsight
          contract: baton/interfaces/api.py = web/src/api/contract.ts      contract: baton/interfaces/ai.py
```

## Scope

**In:**
- Chat on Model A, with a handoff to the next model on a 429 or a manual switch.
- An "Exhaust rate limit" burst on Groq models.
- An extractor that records the goal, decisions, constraints, rejections and reversals, the next step, and preferences.
- The contract injected into the system prompt.
- A memory ON/OFF toggle.
- Re-running the last turn with memory flipped.
- Checks: `rejected`, `continuity` and `no_bullets`, with one repair retry when memory is ON.
- Redaction before anything is stored.
- Hindsight retain per turn, and recall at session start and handoff. If Hindsight fails, fall back to SQLite with an alert.
- Tabs: Baton (the contract, with Copy baton), Ledger (with reverse), and Memory trace.

**Out:** the patch statistics and learning chart, seeding, the team view, "Why?", Ollama, and the full conformance suites.

## Rules for every sector

- Import other sectors only through `baton.interfaces`. The one exception is `baton/backend/wiring.py`, which may import `baton.ai.build.build_ai`.
- Never commit `.env` or keys. Tests run with no network. Live tests are marked `@pytest.mark.live`.
- Commit often on your own branch, with small commits.
- Windows, Python 3.13 and Node 24. Use the worktree's own `.venv`.
