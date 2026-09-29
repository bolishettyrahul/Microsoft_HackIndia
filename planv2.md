# Baton plan v2: the work split into AI, backend and frontend

> One section per owner: AI (§1), backend (§2), frontend (§3), with shared context in §0 and the integration lead's schedule in §4.
> Deadline: **09:00 IST, 30 Sep 2026.** Written at 00:30 IST.

---

## 0. Shared context (everyone reads this)

### 0.1 Where the project stands

| Area | State | Evidence |
| --- | --- | --- |
| AI, backend and frontend | Built, merged into `main`, pushed | `main` = `origin/main` = `e8edb05` |
| Python tests | 20/20 pass | `python -m pytest -q tests/ai tests/backend` |
| AI ↔ backend ↔ HTTP integration | 20/20 endpoint checks pass | A probe with the real AI classes and backend over FastAPI's `TestClient`, and scripted provider clients |
| Frontend client ↔ backend | All 17 paths match | `web/src/api/http.ts` vs `baton/backend/app.py` |
| Frontend tests and build | Not run | `web/node_modules` isn't installed |
| Real Groq, Gemini and Hindsight calls | Never run | No `.env`; `hindsight_client` isn't installed |

**What the probe showed:**
- A 429 on Model A hands off to Gemini, and the contract is in Gemini's system prompt.
- Gemini's Redis re-suggestion is caught and repaired.
- A re-run with memory OFF carries no contract.
- The burst cools the model down.
- An unknown session gives a 404, and a model that can't burst gives a 422.
- With no keys, the app returns `no_model` and a copyable contract.

**Bugs found, and who owns each:**

| # | Bug | Owner |
| --- | --- | --- |
| 1 | If `HINDSIGHT_API_KEY` is set but the Hindsight client fails to start, `build_ai` raises and the whole app is down | AI |
| 2 | `BATON_AI=fake` is ignored by `wiring.py`, although the README documents it | Backend |
| 3 | Any `ModelUnavailable` disables the model for the whole process, so one 5xx or timeout kills it (spec §9.3: `error` → 30 s cooldown; `bad_request` → skip this turn; `auth` → disable) | Backend |
| 4 | The transcript (`Baton._turns`) is in memory only, so a backend restart empties the chat | Backend |
| 5 | On a re-run, `seen_model` counts the current turn's own replies, so the continuity chip disappears | Backend |
| 6 | README links are `file:///C:/…` paths (broken on GitHub), and it names a `docs/specs/` folder that doesn't exist | Integration lead |

### 0.2 The product we're finishing: Baton as the bridge between ChatGPT and Claude

**Not generic memory.** Baton carries a **checked, typed contract** between AI apps:
- the goal, decisions and constraints;
- **rejected approaches, with reasons and aliases**;
- the **next step**, open questions and preferences;
- who decided each item, in which app and with which model.

Code, not an LLM, checks replies against it.

**The story:**
1. **Plan in ChatGPT.** "Add caching… no Redis, we're on a free tier." ChatGPT calls Baton's `record_items`, or you paste the exchange into Baton's Import box. Baton stores the typed items.
2. **Switch to Claude,** because of a limit or because you prefer it. Say *"pick up the baton for demo"*. Claude calls `pull_baton`, gets the contract, and continues from the next step without suggesting Redis.
3. **Claude calls `check_reply`** on its draft. Baton's checks (rejected approach, continuity, no-bullets) return pass or fail with evidence and the fix rule.
4. **Claude records the new decisions** (`record_items`). The baton can go back to ChatGPT the same way.
5. **Baton's Bridge page shows it all live:** the ChatGPT lane, the Claude lane, the shared baton in the middle, and a timeline of every pull, record, check and import.

Baton's own chat (Groq and Gemini, with a 429 handoff) stays as the in-app demo of the same engine.

**Your setup:**
- **Keys:** Groq, Gemini and Hindsight.
- **Apps:** Claude Desktop, Claude Pro, ChatGPT Go.
- **ChatGPT Go:** it isn't confirmed that Go offers Developer mode (custom MCP connectors), so check first. Settings → Apps & Connectors → Advanced → Developer mode.
  - **If it's there:** ChatGPT connects over a tunnel.
  - **If not:** ChatGPT uses the **Import box** plus **Copy baton**, and the Claude side stays fully automatic.

### 0.3 Rules for everyone

- **Edit only your own files** (tables below). Contracts live on `main` and change only there. If one is wrong, tell the integration lead; don't patch it on your branch.
- **Import other sectors only through `baton.interfaces`.** The one exception is `baton/backend/wiring.py`, which calls `baton.ai.build.build_ai`.
- **Keep the test suite offline.** Tests needing keys are marked `@pytest.mark.live`. Never commit `.env`.
- **Commit small and often on your branch.** Merge order: AI → backend → frontend.
- **Nothing public may contain the word "hackathon":** no repo file, video or post.

### 0.4 Contracts v2: the integration lead lands these on `main` first (00:45–01:05)

Additive only. `CONTRACT_VERSION` becomes `"2h-2.0"`.

```python
# baton/interfaces/types.py
BridgeApp = Literal["chatgpt", "claude", "baton"]

class BridgeEvent(Frozen):
    at: datetime
    project: str
    app: BridgeApp
    action: Literal["pull", "record", "check", "import"]
    summary: str                 # "Pulled the baton (7 items)", "Rejected: Redis", "Draft failed: rejected approach"
    items: int = 0               # items pulled or recorded
    passed: bool | None = None   # for checks

# baton/interfaces/ai.py, added to Store
def project_items(self, project: str) -> list[Item]: ...        # L1 items from every session of the project
def log_bridge_event(self, event: BridgeEvent) -> None: ...
def bridge_events(self, project: str, limit: int = 50) -> list[BridgeEvent]: ...   # newest first

# baton/interfaces/api.py (mirrored in web/src/api/contract.ts)
class AppStatus(Frozen):
    app: Literal["chatgpt", "claude"]
    connected: bool              # seen in the last 10 minutes
    last_seen: datetime | None
    pulls: int
    records: int
    checks: int

class BridgeView(Frozen):
    project: str
    apps: tuple[AppStatus, ...]
    events: tuple[BridgeEvent, ...]
    contract: ContractView       # project-wide: every session and app
    ledger: tuple[LedgerRow, ...]

class BridgeSetup(Frozen):
    claude_desktop_config: str   # JSON snippet to paste into claude_desktop_config.json
    claude_url: str              # e.g. http://localhost:8000/mcp/claude/<token>
    chatgpt_url: str | None      # the public tunnel URL, if BATON_PUBLIC_URL is set
    public_claude_url: str | None

class ImportExchange(Frozen):
    app: Literal["chatgpt", "claude"] = "chatgpt"
    user_message: str
    assistant_reply: str

# New endpoints
# GET  /api/projects/{project}/bridge          -> BridgeView
# GET  /api/bridge/setup                       -> BridgeSetup
# POST /api/projects/{project}/import  ImportExchange -> BridgeView
```

**Also on `main`:**
- **`requirements.txt`:** add `mcp`.
- **`.env.example`:**
  - `BATON_MCP_TOKEN`, a random string in the MCP URL so a tunnelled URL isn't guessable;
  - `BATON_PUBLIC_URL`, the tunnel URL, when there is one.
- **`CLAUDE.md`:** the new scope and the new file ownership.
- **Worktrees:** recreate `ai` and `backend` from `main`, and fast-forward `frontend`.

---

## 1. AI owner

**Your job:** everything that talks to the outside world, meaning model providers, SQLite and Hindsight, behind the `AIServices` contract. You make sure real calls work, fail visibly, and never crash the app.

### 1.1 Your files

`baton/ai/**`, `tests/ai/**` and `tests/live/**`.

### 1.2 How your part works today

**`provider.py`: `OpenAICompatModel`.** One adapter for Groq and Gemini through the `openai` SDK, with `max_retries=0` so 429s surface for handoff, and a 60 s timeout.
- **Per model:** `reasoning_effort="low"` for gpt-oss and Gemini; `reasoning_effort="none"` with `reasoning_format="hidden"` for Qwen.
- **Structured output:** when `json_schema` is passed, it sends `response_format` as strict `json_schema`.
- **Error mapping** to the only two contract errors:

  | Provider error | Becomes |
  | --- | --- |
  | `RateLimitError` | `RateLimited(retry_after)`, from the `retry-after` header, then Gemini's `retryDelay` in the body, then 60 s |
  | 401/403 | `ModelUnavailable("auth")` |
  | 400 | `ModelUnavailable("bad_request")` |
  | timeout, connection error, 5xx, anything else | `ModelUnavailable("error")` |

- **Reasoning:** `<think>` blocks are stripped.

**`chain.py`: `RuntimeModelChain`.**
- **Scope:** the active model per session; benched models per session (manual switch); cooldowns and disables are global, because rate limits belong to the key.
- **`candidates()`** returns the active model first, then chain order, wrapping around, and skips anything cooling, benched or disabled.
- **`status()`** reports ready, cooling (with `cooldown_until`), benched or disabled.
- **`burst(model)`** (Groq only) sends up to 6 padded requests of about 2,500 tokens each, with `max_tokens=1`, until a 429, then cools the model down.

**`extractor.py`: `StructuredExtractor`.**
- **Models:** tries the extractor chain in order (`gpt-oss-20b`, then `gemini-3.5-flash-lite`).
- **Prompt:** the system prompt keeps only what the USER stated, accepted, rejected or reversed. The input is the current contract (as data), the user message and the reply.
- **Output:** strict JSON `{items:[{kind,text,reason,aliases,check_id,target}]}`.
- **On failure:** retries once with the validation error appended; falls through to the next model on 429 or unavailable. It never raises: total failure is an `EXTRACTION_FAILED` alert.

**`store.py`: `SQLiteStore`.**
- **Connections:** one connection per thread, in WAL mode.
- **Tables:** `sessions`, `messages` (every user message and assistant attempt, with `is_final`), `verifications`, `contract_items` (L1), `handoffs` and `recalls`.
- **Behaviour:** `KeyError` for unknown ids. `set_final` marks one assistant attempt final per turn.

**`hindsight.py`: L2.**
- **Threading:** `MemoryService` runs a daemon thread that owns an asyncio loop and the Hindsight client.
  - `submit(op, timeout)` waits for the result.
  - `fire(op)` is fire-and-forget.
- **Banks:** `ensure_bank` creates `baton-<slug>` (verbatim extraction, observations on, with three directives).
- **`retain`** sends one `aretain_batch` per document. Each item's full fields travel in `metadata` and `kind:<kind>` tags. `document_id` replaces the document.
- **`snapshot`** runs two parallel recalls:
  - **state:** goal, decisions, constraints, preferences, next step, questions;
  - **ledger:** rejections and reversals.

  It rebuilds `Item`s **from metadata, not recalled text**. It never raises: a timeout gives `LTM_UNAVAILABLE` and a 402 gives `LTM_NO_CREDITS`.
- **`UnavailableLongTermMemory`** is the visible local-only fallback when there's no key.

**`build.py`: `build_ai(settings)`.**
- **Wiring:** builds profiles from `provider:model` ids, then the chain, the extractor, the store and the memory.
- **Missing keys:** a model whose key is missing is **disabled with a reason**, so it shows red in the UI rather than crashing.

### 1.3 What you build

**A1. Live check (01:05–01:45)**
- **Setup:** create `.venv` and run `pip install -r requirements.txt`. This installs `hindsight-client`, which isn't installed yet. Needs the `.env` with keys.
- **Write `tests/live/test_ai_live.py`** (`@pytest.mark.live`):
  - one `complete()` per chain model (Groq `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`; Gemini `gemini-3.5-flash`), asserting a non-empty text reply and a sane latency;
  - `StructuredExtractor.extract()` on a real exchange ("No Redis, we're on a free tier; use an in-process cache"), asserting a `rejection` item with text "Redis" and a reason, on **both** extractor models;
  - Hindsight: `ensure_bank("baton-live-test")`, then `retain` two items, poll `snapshot` for up to 30 s, and assert the items come back **with ids, kinds and aliases intact** from metadata. Record how long indexing took. This is spec §21, questions 1 and 2, and the demo depends on the answer.
- **Record findings** in `docs/research/2026-09-30-live-findings.md`: latencies, retain-to-recall delay, and any provider quirks (for example whether Gemini honours strict `json_schema` and `reasoning_effort`).
- **Fix what breaks** in `provider.py`, `extractor.py` or `hindsight.py`.

**A2. Hindsight must never crash the app (bug 1, 01:45–02:00)**
- In `build_ai`, construct `HindsightLongTermMemory` inside `try/except RuntimeError`.
- On failure, use `UnavailableLongTermMemory` with a message that says why, for example "Hindsight client failed to start: <reason>; using local memory only". This needs a small change: let it take a message argument.
- **Test:** a `client_factory` that raises gives a working `AIServices` whose `snapshot()` returns that alert.

**A3. Store support for the bridge (02:00–02:45)**
- **`project_items(project)`:** all `contract_items` rows for that project, across sessions, oldest first. The bridge needs this, so a Claude pull sees what ChatGPT recorded a second earlier, even while Hindsight is still indexing.
- **A new `bridge_events` table,** with columns `id`, `project`, `at`, `app`, `action`, `summary`, `items` and `passed`, plus an index on `(project, at)`.
- **`log_bridge_event()`** and **`bridge_events(project, limit)`**, newest first.
- **Tests:** round trips; `project_items` spans two sessions and ignores other projects; event ordering and limit.

**A4. The `openai:` provider seam (02:45–03:00, small)**
- Add `"openai": "https://api.openai.com/v1"` to `_BASE_URLS`, with an `OPENAI_API_KEY` setting.
- With no key, the model shows "disabled: OPENAI_API_KEY is not configured", which matches how missing Groq and Gemini keys are handled.
- No live test, since there's no key. Claude as an in-app model is **out of scope** without an Anthropic key; see §6.

**A5. Support integration (03:30 onwards)**
- Be on call for live failures during merge and rehearsal.
- Run `pytest -m live` again after the merge.
- Keep a fresh Groq key ready for recording.

### 1.4 What you hand the backend

- The same `AIServices(chain, extractor, store, memory)`, plus the three new `Store` methods.
- **Guarantees:** nothing in `AIServices` raises except `RateLimited`, `ModelUnavailable` and `KeyError`; memory failures are alerts.

### 1.5 Done when

- `pytest tests/ai` passes, including the new tests.
- `pytest -m live tests/live` has passed at least once with real keys.
- The findings doc is written.
- With a bad Hindsight setup, the app still starts and shows the amber banner.

---

## 2. Backend owner

**Your job:** the brain and the API. The turn loop, the contract engine and the checks, the HTTP API the UI calls, and now the **MCP bridge** that ChatGPT and Claude call.

### 2.1 Your files

`baton/backend/**` and `tests/backend/**`, plus the new `tests/integration/**`.

### 2.2 How your part works today

**`facade.py`: `Baton`.** One object per process, and every HTTP route calls a method on it.
- **What it holds:** a per-project cache of L2 snapshots, a per-session list of `TurnView`s (in memory, which is bug 4), and a per-session lock so two sends can't interleave.
- **What it does:** builds views (`SessionView`, `ContractView`, `LedgerRow`, `TraceView`) and runs user actions: switch model (bench, then a `manual` handoff event), use a model, burst, and reverse a rejection. A reversal writes a `reversal` item that supersedes the rejection, then retains it to L2 as document `{session}:edit:{item}`.

**`turn.py`: `TurnRunner.run()`, the turn loop.**
1. Load the session and the L2 snapshot. Build the contract with `combine(L1 session items, L2 items)`, then `render` it and redact it.
2. Save the user message (redacted).
3. For each candidate model (active model first):
   1. build the history (the last 6 final messages; with memory OFF, only this model's own turns);
   2. `compose()` the prompt;
   3. call the model.
4. **On 429:** cool the model down, refresh the L2 snapshot, rebuild the contract, log a `HandoffEvent` (with an `EMPTY_CONTRACT` red alert if there's no context), and try the next model.
5. **On `ModelUnavailable`:** the same, but today it **disables** the model (bug 3).
6. **Verify the reply,** and save it with its checks.
7. **Repair once,** if a check failed and memory is ON: set the failed checks' patch level to 1, recompose and retry the same model. The first attempt goes into `earlier_attempts`. A 429 during repair keeps the first reply and adds a `REPAIR_SKIPPED` alert.
8. Set the model active (sticky), mark the reply final, then **extract**:
   1. run the extractor on the redacted exchange;
   2. give each item an id and metadata;
   3. resolve reversal and resolved targets (unmatched gives a `REVERSAL_UNMATCHED` alert);
   4. apply the alias safety rule;
   5. apply preferences (`no_bullets` turns the check on);
   6. redact;
   7. store in L1;
   8. retain to L2 as document `{session}:{turn}`.
9. **If no model answered,** return `NO_MODEL` and the copyable contract (`fallback_contract`).

**A re-run** (`rerun_last_turn`) forces the same model with memory flipped. It uses the contract as it stood before this turn, and replaces the turn's items (`replace_turn_items`) and its L2 document.

**`contract.py`: the engine.**
- **`combine`** merges L1 and L2 (L1 wins inside the current session), drops superseded items, removes duplicates by normalised text, and applies the caps: 12 decisions, 10 constraints, 15 rejections, 5 open questions. The latest goal and next step win, and preferences are derived.
- **`render`** gives the `<baton_contract>` block, one labelled line per item with no list markers, marked as data.
- **`ledger`** gives rejection rows, active or reversed.
- **`resolve`** matches target text to an item by normalised text or alias.
- **`validate_aliases`** caps aliases and drops any alias that appears in an active decision or constraint.

**`verifier.py`: deterministic checks.**

| Check | Fails when |
| --- | --- |
| `rejected` | An approach or alias matches as a whole word, and isn't negated by the 5 words before it (not, no, avoid, instead of…) or the words after it (is ruled out…). The evidence is the matching sentence. |
| `continuity` | Only on a model's first reply when context exists: the reply asks what the project is |
| `no_bullets` | A list line appears outside code fences |

**`compose.py`.**
- **Memory OFF:** a neutral system prompt, own history, and the user message.
- **Memory ON:**
  - the Baton system prompt plus the contract;
  - level-1 rules in the system prompt;
  - level-2 reminders appended to the user message;
  - level-3 examples.

**`redact.py`** covers Groq, OpenAI/Anthropic, Google, GitHub, AWS, JWT, `.env`-style `key=value` and emails. It runs before anything is stored or shown.

**`app.py`** holds the 17 FastAPI routes under `/api`. `KeyError` becomes 404, and burst errors become 422.

**`wiring.py`** does `build_baton(settings, ai=None)`, which builds real AI unless `ai` is passed (bug 2).

### 2.3 What you build

**B1. Bug fixes, test-first (01:05–01:45)**
- **Bug 2:** move the fake AI from `tests/backend/fakes.py` into `baton/backend/fake_ai.py`. Tests import it from there. When `settings.ai == "fake"`, `build_baton` uses it, and `/api/health` reports `ai: "fake"`.
- **Bug 3:** in `turn.py`, on `ModelUnavailable`:

  | Reason | Action | Alert |
  | --- | --- | --- |
  | `auth` | `disable` | red |
  | `error` | `cool_down(model_id, 30)` | amber |
  | `bad_request` | skip this turn only, nothing global | amber, with the provider message |

  **Test:** a 500 on Model A leads to a handoff, and Model A shows `cooling`, not `disabled`.
- **Bug 4:** when `_turns[sid]` is empty but the store has messages, rebuild `TurnView`s from `store.messages()` and `store.verifications()`: the final reply per turn, earlier attempts from non-final replies, and handoffs from `store.handoffs()`. **Test:** a new `Baton` over the same store returns the same transcript.
- **Bug 5:** `seen_model` only counts records with `turn < current turn`. **Test:** a re-run keeps the continuity chip.

**B2. Commit the integration test (01:45–02:00)**
- Turn the probe into `tests/integration/test_http_flow.py`:
  - the real `OpenAICompatModel` with scripted `client=` objects;
  - `RuntimeModelChain`, `StructuredExtractor`, `SQLiteStore` (temporary database) and `UnavailableLongTermMemory`;
  - the whole flow driven through `TestClient`: all 17 endpoints, 429 handoff, repair, re-run, burst, 404 and 422.
- It's the standing proof that the three parts are integrated.

**B3. `bridge.py`: the bridge service (02:00–03:00)**
- **`Bridge(ai, settings)`**, owned by `Baton` (as `baton.bridge`).
- **External sessions:** one per (project, app), with `user="ChatGPT"` or `user="Claude"`. Create it on first use and cache the id, looking up existing sessions by project and user.
- **`pull(project, app) -> str`:**
  - builds the contract with `combine(store.project_items(project), snapshot.items, session_id=<the app's session>, …)`, then `render` and `redact`;
  - adds a short header: "This is the Baton for <project>. Continue from Next step. Do not suggest anything listed as Rejected. Before answering, call check_reply with your draft.";
  - logs a `pull` event ("Pulled the baton (N items)").
- **`record_items(project, app, items) -> str`:**
  - validates each item's kind against `ExtractedItem`;
  - for reversal and resolved items, runs `resolve` against `project_items`;
  - runs `validate_aliases`, then `redact_item`;
  - `store.add_items` into the app's session, with the next turn number;
  - `memory.retain(project, f"{session}:bridge:{n}", items)`;
  - logs a `record` event summarising the kinds ("Rejected: Redis · Decision: in-process TTL cache");
  - returns the new next step and the active rejections.
- **`record_exchange(project, app, user_message, assistant_reply)`:** the same, but the items come from `ai.extractor.extract()`. Reuse the item-building logic in `TurnRunner._extract` by moving it into a shared function, not by copying it. The same function serves `POST /api/projects/{project}/import`, which logs an `import` event.
- **`check(project, app, draft)`:**
  - `verify(draft, state, continuity=<this app's first check>)`;
  - returns a pass, or each failed check with its evidence and the rule sentence from `compose._RULES`;
  - logs a `check` event with `passed`.
- **`view(project) -> BridgeView`:**
  - `AppStatus` per app, from its events (connected if seen in the last 10 minutes);
  - the latest 50 events;
  - the project-wide `ContractView` and `ledger`.

**B4. `mcp_server.py`: the MCP tools (03:00–03:45)**
- **Server:** the `mcp` Python SDK's `FastMCP`. `build_mcp(bridge, app)` returns a server for one app. Mount two of them in `app.py`, at `/mcp/claude/{BATON_MCP_TOKEN}` and `/mcp/chatgpt/{BATON_MCP_TOKEN}`, over streamable HTTP. The URL tells Baton which app is calling.
- **Lifespan:** start both servers' `session_manager.run()` in the FastAPI lifespan.
- **Spike first:** 15 minutes on mounting FastMCP inside FastAPI, with a minimal server and an MCP SDK client round trip.
- **Tools.** Their descriptions are what ChatGPT and Claude read, so write them carefully:

  | Tool | Description the model sees |
  | --- | --- |
  | `pull_baton(project)` | "Get the Baton for a project: the goal, the next step, decisions, constraints, rejected approaches with reasons, and preferences, recorded across ChatGPT, Claude and Baton. Call this when the user says to pick up, continue or resume a project, or mentions Baton." |
  | `record_items(project, items)` | "Record what the USER decided in this conversation. Call it after the user accepts, rejects or reverses an approach, sets a goal, states a constraint or preference, or when the next step changes. Only record what the user stated or accepted, never your own suggestions. Kinds: goal, decision, constraint, rejection (with reason and aliases), reversal (target = the rejected approach), preference, next_step, open_question, resolved." |
  | `record_exchange(project, user_message, assistant_reply)` | "Alternative to record_items: send the latest exchange, and Baton extracts the items itself." |
  | `check_reply(project, draft)` | "Before sending an answer on a Baton project, check your draft. It returns the failures with evidence and the rule to follow. If anything fails, rewrite and check again." |
  | `get_ledger(project)` | "List rejected approaches with reasons, aliases, who rejected them, and whether they were reversed." |

- **Tests:** call each tool function directly, plus one round trip through the MCP SDK's in-memory client. That round trip is the proof that ChatGPT and Claude will see the same tool list.

**B5. The bridge HTTP endpoints (03:45–04:00)**
- `GET /api/projects/{project}/bridge`, `GET /api/bridge/setup` and `POST /api/projects/{project}/import`, as in §0.4.
- `setup` builds the Claude Desktop snippet:

  ```json
  {"mcpServers": {"baton": {"command": "npx", "args": ["-y", "mcp-remote", "http://localhost:8000/mcp/claude/<token>"]}}}
  ```

  It also returns the public URLs when `BATON_PUBLIC_URL` is set.

**B6. Connect the real apps (04:15–05:00, with the integration lead)**
- **Claude Desktop:**
  1. Paste the snippet into `%APPDATA%\Claude\claude_desktop_config.json`.
  2. Restart Claude Desktop.
  3. Check that the Baton tools appear.
  4. Say "pick up the baton for demo", and check that a `pull` event shows on the Bridge page.
- **ChatGPT Go,** if Developer mode exists:
  1. Run `cloudflared tunnel --url http://localhost:8000` (install with `winget install Cloudflare.cloudflared`).
  2. Set `BATON_PUBLIC_URL`.
  3. Add `https://<tunnel>/mcp/chatgpt/<token>` as a connector.
  4. Check that `record_items` fires.

  If Developer mode doesn't exist, use the Import box.
- **claude.ai (Pro),** optional: the same tunnel, `/mcp/claude/<token>`, added as a custom connector.

### 2.4 What you hand the frontend

- The 17 existing endpoints (unchanged) and the 3 bridge endpoints.
- In fake mode (`BATON_AI=fake`), the whole API runs without keys.

### 2.5 Done when

- `pytest tests/backend tests/integration` passes: bug regressions, the bridge service, the MCP round trip, and the HTTP flow.
- Claude Desktop lists and calls the tools against the live backend.
- Every bridge call appears in `GET /api/projects/{project}/bridge`.

---

## 3. Frontend owner

**Your job:** everything people see. The landing page, the in-app demo (`/app`), and the new **Bridge page** that makes Baton look like the relay between ChatGPT and Claude.

### 3.1 Your files

`web/**`, except `web/src/api/contract.ts`, which is owned by `main`.

### 3.2 How your part works today

**Stack:** React 19, Vite 8, Tailwind v4, TypeScript and react-router, with react-three-fiber for the hero. The "Night Relay" design: graphite surfaces, one colour lane per model, the baton gradient, and the Instrument Serif, Inter and JetBrains Mono typefaces.

**Routes** (`main.tsx`): `/` is `Landing` and `/app` is `AppPage`.

**The API layer** (`src/api/`):
- `contract.ts` holds the types.
- `http.ts` is `createHttpApi()`, one function per endpoint (all 17). Errors become `ApiError(status, detail)`.
- `mock.ts` is `createMockApi()`, a scripted in-browser backend: the demo acts with latency and a delayed extraction.
- `index.ts` picks one from `VITE_API_MODE`:
  - `npm run dev` loads `.env.development`, which is **mock**;
  - `npm run dev:live` loads `.env.live`, which is **http**, proxied to `:8000` by `vite.config.ts`.

**`app/useBaton.ts`** is the single state hook.
- **State:** session, turns, models, contract, ledger, trace, busy, error, burst and `now`.
- **Actions:** `start`, `send` (an optimistic turn and a double-submit guard), `rerun`, `setMemory`, `setNoBullets`, `switchModel`, `pickModel`, `exhaust` (burst), `reverse`, `refreshMemory` and `newSession`.
- **Refresh:** after each reply, the side panels poll every 2 s for 10 s while extraction lands. The models poll while any is cooling, and countdowns tick every second. The session id is kept in `sessionStorage`, so a reload restores it.

**Screens:**
- **`AppPage`:** a StartScreen (project and user) leading to a Workspace (TopBar, Chat and the side panel), plus toasts.
- **`TopBar`:**
  - a relay strip of model pills: the active one holds the baton, cooling ones count down, and clicking one switches to it;
  - the memory toggle;
  - a DemoMenu with Exhaust rate limit, Switch model, Refresh memory and the No-bullets check.
- **`Chat`:** turns with model badges and lane tags, check chips (pass or fail, with evidence), handoff banners, collapsed earlier attempts (repaired or replaced), a re-run button on the last turn, a copyable fallback contract, and alert banners.
- **`Tabs`:**
  - Baton (goal, next step, decisions, constraints, rejections, questions, and Copy baton);
  - Ledger (reverse with a reason);
  - Trace (recall traces, and L1 vs L2 items).
- **`Landing`:** a story scroll (the 429 wall, the handoff, a before/after table, the checks and repair, the contract), the 3D handoff hero (`HeroScene`), and the sticky 7-step `LoopSection`.
- **Tests:** `src/__tests__/api.test.ts` (Vitest) covers mock states, request shapes and lanes.

### 3.3 What you build

**F1. Install, test, build and run live (01:05–01:35)**
- `cd web && npm install && npm test && npm run build`. Fix any type or build errors.
- Run `npm run dev:live` against `uvicorn baton.backend.app:app --port 8000`, with `BATON_AI=fake` once B1 lands, and then with real keys.
- Walk through `/app`: start → send → burst → handoff banner → memory OFF → re-run → reverse → Copy baton. Log anything that breaks, and hand backend issues to the backend owner.
- After a backend restart, a restored session must show the transcript. That depends on bug 4; if it can't be restored, show an empty state.

**F2. The Bridge page, `/bridge` (01:35–03:15)**
- **Where:** a new route in `main.tsx` and a "Bridge" link in the TopBar and the landing page's nav.
- **Data:** a `useBridge(project)` hook polls `GET /api/projects/{project}/bridge` every 2 s, plus `GET /api/bridge/setup` once. The project picker is fed by `GET /api/projects`.
- **Layout, three columns** (they stack on mobile):
  - **Left, the ChatGPT lane:** app name and icon; a connection light (green when seen in the last 10 minutes, otherwise grey); last seen ("12 s ago"); counters for pulls, records and checks; and that app's latest events.
  - **Centre, the Baton:** the shared contract (goal, **next step** emphasised, decisions, constraints, **rejected approaches with reasons**), each line tagged with the app and person who recorded it; the ledger underneath; and a "Copy baton" button.
  - **Right, the Claude lane:** the same as ChatGPT.
- **Relay timeline** under the columns: every `BridgeEvent`, newest first, with an app icon, action icon, summary and time.
  - A **pass or fail tag** on checks: a failed check shows red, and the next passing check shows green, so a repair is visible.
  - **An animation** when a new event arrives: the baton moves from the lane that recorded to the lane that pulled. Reuse the lane colours in `lib/lanes.ts`, and respect reduced motion.
- **Empty states:** "No app connected yet", which links to the Setup panel, and "No baton yet for this project".

**F3. The Setup panel (03:15–03:45)** is a drawer on `/bridge`:
- **Claude Desktop, in three steps:**
  1. copy the config snippet (`BridgeSetup.claude_desktop_config`);
  2. paste it into `%APPDATA%\Claude\claude_desktop_config.json`;
  3. restart Claude, and say "pick up the baton for <project>".
- **ChatGPT:** if `chatgpt_url` is set, show the steps to add it as a Developer mode connector. If not, explain that ChatGPT uses Import plus Copy baton, and link to the Import box.
- **claude.ai:** show `public_claude_url` when there is one.
- **Security:** a note that the URLs contain a private token.

**F4. The Import box (03:45–04:00)** is a "Paste from ChatGPT" card on `/bridge`:
- **Fields:** two textareas (your message, ChatGPT's reply) and an app selector.
- **Submit:** `POST /api/projects/{project}/import`. Show the recorded items as a toast, and the timeline updates.

**F5. Mock mode and tests (in parallel with F2–F4)**
- **Mock:** extend `mock.ts` with a scripted bridge story (ChatGPT records → Claude pulls → Claude's check fails → it passes) and fake setup data. That way the page is demo-able without the backend.
- **Vitest:**
  - the request shapes for the 3 new endpoints;
  - the lane status logic (connected vs idle);
  - the timeline ordering;
  - the Import box posting the right body.

**F6. Landing and polish (05:00–06:30)**
- **The landing page:** add a chapter, "One baton, every app: ChatGPT ↔ Baton ↔ Claude", with a Bridge mock and a CTA to `/bridge`.
- **Demo polish:** make sure the demo path reads well at 1080p for the video.

### 3.4 What you get from the backend

The 17 existing endpoints and the 3 bridge endpoints (§0.4). Build on mock mode first, then switch to `dev:live`.

### 3.5 Done when

- `npm test` and `npm run build` pass.
- `/app` and `/bridge` work in mock and live mode.
- A real Claude Desktop pull appears on `/bridge` within 2 s.

---

## 4. Integration lead (me, on `main`)

| Time (IST) | Task |
| --- | --- |
| 00:45–01:05 | Land contracts v2 (§0.4), `CLAUDE.md`, requirements, `.env.example`; recreate the worktrees; start the three owners |
| 01:05–03:30 | Watch progress and answer contract questions. Fix bug 6 and rewrite the README (the bridge story, relative links, setup for both apps, limitations). Write `docs/demo-script.md` |
| 03:30–04:15 | Merge AI → backend → frontend with `--no-ff`. After each merge, run the full suite (`pytest -q`, `npm test`, `npm run build`) and the HTTP integration test |
| 04:15–05:00 | Connect Claude Desktop and ChatGPT with the backend owner (B6) |
| 05:00–06:30 | Rehearse the demo twice, end to end, and route fixes to their owners |
| 06:30–08:30 | Deliverables: record the video; write the article and the LinkedIn and Reddit posts, with the word "hackathon" appearing nowhere; update `done.md` |
| 08:30–09:00 | Buffer, final push, submit |

**Who waits on whom:**
- All three depend only on contracts v2 (00:45–01:05). After that there are **no cross-sector waits** until the merge at 03:30.
- The backend builds on the fake AI and fake store. It adds `project_items` and the bridge events to its fake.
- The frontend builds on mock mode.

---

## 5. Demo script (for the video)

1. **In-app engine (about 60 s).**
   1. `/app`: plan caching with gpt-oss-120b, and reject Redis. The ledger fills in.
   2. Click "Exhaust rate limit". A real 429 hands off to Gemini, and the banner shows it.
   3. Re-run with memory OFF: Gemini asks what you're building and suggests Redis, and the chips go red.
   4. Re-run with memory ON: Gemini continues from the next step, and the chips go green.
2. **The bridge (about 90 s).**
   1. `/bridge` with ChatGPT and Claude lanes.
   2. In ChatGPT, plan and reject Redis. It's recorded, through the tool or the Import box.
   3. In Claude Desktop, say "pick up the baton for demo". Claude pulls it, continues from the next step, and checks its draft.
   4. The Bridge page animates the relay and shows each event.
3. **Close (about 20 s).** Copy baton works anywhere. Say why this isn't memory: typed items, the rejection ledger, the checks, provenance.

---

## 6. Optional, only if API keys appear

Claude and GPT as models **inside** Baton's own chat:
- **GPT:** the `openai:` provider (A4) plus `OPENAI_API_KEY`.
- **Claude:** a new `baton/ai/anthropic_provider.py`, built on the official `anthropic` SDK:
  - model `claude-opus-5-5`, `max_retries=0`;
  - the Baton system message goes in `system`;
  - read text blocks only;
  - `RateLimitError` becomes `RateLimited`, from `retry-after`;
  - a `refusal` stop reason becomes `ModelUnavailable`;
  - server-side `fallbacks: "default"`.

This is out of the 09:00 scope, because it can't be tested without keys.

---

## 7. Verification

- **Offline, every merge:**
  - `python -m pytest -q` covers the AI, backend, bridge, MCP round trip and the HTTP integration flow.
  - `cd web && npm test && npm run build`.
- **Live, after the AI merge and again before recording:** `python -m pytest -m live -q`, which covers each model, strict-schema extraction, and the Hindsight retain → recall with metadata intact.
- **UI:** Playwright drives `/app` through the in-app acts, and `/bridge` to confirm events appear after tool calls.
- **Bridge:**
  - Claude Desktop lists the 5 Baton tools.
  - "Pick up the baton for demo" returns the contract.
  - A draft mentioning Redis fails `check_reply` with evidence.
  - Each call appears on `/bridge` within 2 s.
  - ChatGPT's record, over the tunnel or through Import, is visible to Claude's next pull.
