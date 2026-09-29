# Baton

> **Resilient, contract-driven task continuity across multi-model AI workflows.**

When an AI model hits a 429 rate limit or gets swapped out mid-task, stuffing a 40-turn conversational transcript into a fresh model usually fails. The incoming model gets buried in conversational filler, hallucinates around discarded ideas, and re-proposes solutions you rejected twenty minutes ago.

**Baton** replaces messy transcript replaying with a typed, schema-validated **Handoff Contract**. Instead of replaying full chat histories between Groq, Gemini, and local models, Baton extracts the hard engineering state—goals, settled decisions, architectural constraints, and rejected approaches with reasons. When a model fails or is switched, the incoming model receives the verified contract in its system prompt, while deterministic code verifiers check every reply before you see it.

---

## Architecture & The 7-Step Turn Loop

```text
User Input ──► Recall (L1 + L2) ──► Compose Prompt ──► Model Call
                                                           │
                                                      (429 / Error)
                                                           ▼
Feedback ◄── Retain (Hindsight) ◄── Extract ◄── Verify ◄── Handoff
```

1. **Recall**: Pull active state from SQLite (L1 local cache) and historical context from Hindsight (L2 long-term memory).
2. **Compose**: Inject a formatted `<baton_contract>` into the model's system prompt alongside user preferences.
3. **Call**: Dispatch the turn to the active model in the chain (e.g., `gpt-oss-120b` on Groq).
4. **Handoff**: On a 429 rate limit or manual switch, cool the failing model and reroute the contract to the next model in the chain (e.g., `gemini-3.5-flash`).
5. **Verify**: Deterministic code checks scan the generated response. If the model proposed a rejected technology or violated formatting rules, an automated single repair retry fires.
6. **Extract**: A fast utility model extracts newly established goals, decisions, constraints, or rejections from the completed turn.
7. **Retain**: Persist the delta back to local SQLite and dispatch an asynchronous retain to long-term memory.

---

## Key Features

- **Typed Handoff Contracts**: State is compiled into structured `<baton_contract>` blocks containing goals, decisions, constraints, and a rejection ledger.
- **Two-Tier Memory Hierarchy**: Fast local WAL-mode SQLite (L1) paired with [Hindsight](https://hindsight.vectorize.io/) (L2) for cross-session and cross-machine recall.
- **Zero Text Drift**: Domain items are serialized into immutable key-value metadata in Hindsight, bypassing lossy LLM summarization.
- **Deterministic Verification**: Fast regex and AST verifiers (`rejected`, `continuity`, `no_bullets`) check output without adding slow or non-deterministic LLM evaluation calls.
- **Multi-Model Provider Chain**: Automatic failover between Groq (`gpt-oss-120b`), Gemini (`gemini-3.5-flash`), and Qwen, complete with cooldown tracking and rate-limit burst handling.
- **Pre-Storage Secret Redaction**: Sanitizes API keys, JWTs, AWS credentials, and `.env` values before anything touches disk or memory.
- **Interactive Relay Interface**: React 19 + Vite + Tailwind CSS v4 dashboard featuring live model countdowns, baton indicators, a 3D WebGL handoff hero, and one-click "Copy Baton" export.

---

## Repository Structure

```text
.
├── baton/                  # Core Python backend & AI services
│   ├── ai/                 # Model provider adapters, chain, extractor, L1/L2 memory
│   │   ├── provider.py     # OpenAI-compatible Groq & Gemini adapters
│   │   ├── chain.py        # Model chain, sticky selection, cooldowns & burst
│   │   ├── extractor.py    # Schema-strict extraction with retry
│   │   ├── store.py        # Thread-safe SQLite L1 store (WAL mode)
│   │   └── hindsight.py    # Dedicated daemon event-loop thread & Hindsight L2
│   ├── backend/            # Business logic, orchestration, and API
│   │   ├── app.py          # FastAPI application exposing 17 endpoints
│   │   ├── contract.py     # Contract compilation, ledger, and reversal resolution
│   │   ├── verifier.py     # Deterministic checks (rejected, continuity, no_bullets)
│   │   ├── turn.py         # 7-step turn loop, repair retry, and handoffs
│   │   └── redact.py       # Credential and secret sanitization
│   ├── interfaces/         # Sector contracts and shared domain types
│   └── config.py           # Environment and settings parser
├── web/                    # React 19 frontend application
│   ├── src/
│   │   ├── app/            # Main chat, relay top-bar, and Baton inspector tabs
│   │   ├── landing/        # Interactive 3D WebGL handoff hero and turn-loop ring
│   │   └── api/            # Typed contract & client (mock and live modes)
│   └── package.json
├── tests/                  # Deterministic test suites
│   ├── ai/                 # Tests for providers, chain, store, extractor, hindsight
│   └── backend/            # Tests for API endpoints, turn orchestration, verifiers
├── docs/                   # Specifications, research, reports, and articles
│   ├── specs/              # Architecture design and sector contracts
│   ├── research/           # API and provider research notes
│   ├── reports/            # Detailed project report
│   └── articles/           # Technical deep-dive articles
├── pyproject.toml          # Python project definitions
└── requirements.txt        # Python dependencies
```

---

## Quickstart

### 1. Environment Setup

Clone the repository and prepare your Python environment:

```bash
# Create and activate virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Fill in your provider keys in `.env` (never commit keys to git):
- `GROQ_API_KEY`: Groq API key
- `GEMINI_API_KEY`: Google Gemini API key
- `HINDSIGHT_API_KEY`: Hindsight Cloud API key

*(Note: Baton supports offline development with fake AI services when `BATON_AI=fake` is set in `.env`.)*

### 2. Run the Backend API

Start the FastAPI backend with Uvicorn:

```bash
uvicorn baton.backend.app:app --host 0.0.0.0 --port 8000 --reload
```

The API documentation will be available at `http://localhost:8000/docs`.

### 3. Run the Frontend UI

In a separate terminal, install and run the React frontend:

```bash
cd web
npm install

# Run against in-browser mock backend (standalone):
npm run dev

# Run live against the FastAPI backend on port 8000:
npm run dev:live
```

Open `http://localhost:5173` in your browser.

---

## Running Tests

All unit and contract tests run offline without network access or live API keys:

```bash
# Run both AI and Backend test suites
python -m pytest -q tests/ai tests/backend

# Run frontend tests
cd web && npm test
```

---

## Documentation

- **[Design Specification](file:///c:/Users/Rama%20Bolishetty/OneDrive/Desktop/R_D/docs/superpowers/specs/2026-09-29-baton-design.md)**: Complete system design, architecture, and threat model.
- **[Sector Contracts](file:///c:/Users/Rama%20Bolishetty/OneDrive/Desktop/R_D/docs/superpowers/specs/2026-09-29-baton-sectors-and-contracts.md)**: Interfaces and boundaries between AI, Backend, and Frontend.
- **[API Research Notes](file:///c:/Users/Rama%20Bolishetty/OneDrive/Desktop/R_D/docs/research/2026-09-29-api-research.md)**: Verified limits, models, and behavior for Groq, Gemini, and Hindsight.
- **[Technical Article](file:///c:/Users/Rama%20Bolishetty/OneDrive/Desktop/R_D/docs/articles/article.md)**: Deep dive on rebuilding typed state from Hindsight metadata instead of text.
- **[Project Report](file:///c:/Users/Rama%20Bolishetty/OneDrive/Desktop/R_D/docs/reports/project-report.md)**: Initial architectural report and problem statement.
