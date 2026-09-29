# Baton — Project Report

Sep 28, 2026 · @Rahul

## 1. The idea

**Baton is a handoff agent for multi-model work: when you switch AI models mid-task, it carries where you were, not just who you are.** Other memory tools inject context and hope. Baton injects, verifies, repairs, and learns which injection works for each model.

**The problem.** Developers switch models constantly. Claude hits a rate limit, so you move to ChatGPT, and the new model starts from zero. It asks what you're building, and it re-suggests the approach you rejected ten minutes ago. Built-in memories live inside each vendor's account, and neither can read the other's.

**What Baton does, in four moves:**

1. **Carries task state.** Goal, decisions, constraints, open questions, and the next step travel with you as a typed *handoff contract*.
2. **Remembers what you rejected, and why.** A rejection ledger stops the next model from re-suggesting dead ends.
3. **Verifies the new model with code, not an LLM.** After a handoff, the reply is checked against the contract and your preferences. A failed check triggers one repair retry.
4. **Learns per-model behaviour.** It records which prompt patch makes each model follow each preference, and starts with the patch that worked last time.

The verify-and-repair loop is borrowed from Microsoft's R&D-Agent(Q): the LLM only proposes, and a deterministic check decides.

**Competitors, and why Baton is different:**

| Tool | What it carries | Verifies the new model? | Learns per model? |
| --- | --- | --- | --- |
| [Mem0 OpenMemory](https://www.producthunt.com/products/openmemory-chrome-extension) | Preferences, goals, tasks, as facts | No | No |
| [Supermemory extension](https://github.com/supermemoryai/supermemory/pull/418) | Saved memories, searched while typing | No | No |
| [Hindsight ChatGPT connector](https://hindsight.vectorize.io/sdks/integrations/chatgpt) | Whatever the model chooses to retain | No | No |
| **Baton** | Task state, rejected approaches, per-model patches | **Yes, deterministic checks** | **Yes, patch pass rates** |

**Who pays.** The $50/month buyer is a team working across model vendors: one teammate's ChatGPT learns what another teammate's Claude session decided. Anthropic and OpenAI will build memory inside their own products, but neither has a reason to hand your context to a competitor, so cross-vendor handoff is structurally a third-party product.

## 2. User journey and demo story

**The demo proves one claim in under three minutes: with Baton, the second model continues the task; without it, the second model restarts it.** Every judge has lived Act 2.

1. **Act 1: plan with Model A.** The user asks Model A to plan a FastAPI feature. Model A suggests Redis for caching. The user replies "no Redis, we're on a free tier, use an in-process cache." Baton classifies that turn and adds Redis to the rejection ledger with its reason.
2. **Act 2: switch with memory OFF.** Model A returns HTTP 429 (a real Groq rate limit, or the labelled manual-switch button). Model B receives only the latest message. It asks what the user is building and re-suggests Redis. The verifier flags it in red.
3. **Act 3: the same switch with memory ON.** Baton recalls the contract and briefs Model B. Model B opens with the next step and skips Redis, citing the free-tier constraint. The memory panel shows exactly which memories were recalled.
4. **Act 4: the learning curve.** Model B uses a bullet list after the user asked for none. The verifier catches it, retries with a stronger prompt patch, and the retry passes. The chart shows Model B's violation rate falling across seeded sessions, because Baton now starts with the patch that works for it.
5. **Act 5: leave the app.** The user clicks **Copy baton** and pastes the contract into claude.ai. The context travels even to tools Baton doesn't control.

**The before and after, in one table:**

| After the switch | Memory OFF | Memory ON |
| --- | --- | --- |
| First reply | Asks what you're building | Continues from the next step |
| Rejected approach (Redis) | Re-suggested | Skipped, with the reason cited |
| Preference (no bullet lists) | Violated | Passes, with the patch that works for this model |
| What the user retypes | The whole context | Nothing |

## 3. System architecture

**Baton is five layers of plain Python; the verifier in the agent layer is the one component nobody else has.** Each layer calls only the one below it, so any layer can be tested alone.

&#91;embedded content: Baton architecture · 5 layers, 15 components\]

Read it top down: a user turn enters the interface, the turn loop drives the agent layer, the agent reads and writes the two memory tiers, and only the data layer touches the network or disk. Redaction sits in the memory layer so nothing unscrubbed can reach Hindsight.

## 4. Frontend and UI

**One Streamlit page: chat on the left (60%), the baton on the right (40%), controls in the sidebar.** Streamlit keeps the whole app in Python, which matches the team's strongest language and removes a JavaScript build from a one-night sprint.

| Option | Build time | Looks | Risk tonight |
| --- | --- | --- | --- |
| **Streamlit (chosen)** | \~2 h | Clean, a little generic | Low: all Python |
| FastAPI + one HTML/htmx page | \~4 h | Better | Medium: templates, JS for copy and charts |
| React | 8 h+ | Best | High: new stack under deadline |

**Sidebar (controls):**

| Control | What it does |
| --- | --- |
| Project picker | Chooses the Hindsight bank (`baton-<project>`); teammates on the same project share it |
| User name | Tags every retained item, so the team view shows who decided what |
| Model chain | Ordered list, Model A then Model B, each with a status light: green (ready) or amber (cooling down, with a countdown from `retry-after`) |
| Memory ON/OFF toggle | The before/after switch for the demo; OFF sends the new model only the latest message |
| Preferences | Checkboxes for the verifiable preferences (no bullets, max words, no emojis, no preamble, Python for code) with their parameters |
| Switch model now | The labelled manual handoff, for when no real 429 arrives on stage |

**Left column (chat):**

- Every assistant reply carries a **model badge** and a row of **check chips**: green for a passed check, red for a failed one (`:green[pass no-bullets]`, `:red[fail rejected: Redis]`).
- A reply that was retried shows a **repaired** chip, with the first attempt collapsed underneath, so judges can see the repair happen.
- Handoffs appear inline as a banner: *Model A rate-limited (retry in 12 s). Baton passed to Model B, 7 memories recalled.*
- When memory is OFF, the chat gets a grey border and a banner saying the new model is starting fresh.

**Right column, four tabs:**

| Tab | Shows | User can |
| --- | --- | --- |
| Baton | The contract: goal, next step, decisions, constraints, open questions | Edit any field (`st.data_editor`); click **Copy baton**, a markdown block with a built-in copy button (`st.code`) |
| Rejection ledger | Approach, reason, turn, model, status (active or reversed) | Reverse a rejection; edit its aliases |
| Memory trace | The last recall: queries sent, results by type, latency; a red warning when a recall returned 0 results or failed | Expand each recalled memory |
| Model learning | A line chart of violation rate per model per session; a table of patch pass rates; Hindsight observations about each model | Read only |

**Streamlit traps to design around:**

- Streamlit reruns the whole script on every click. Create the Groq and Hindsight clients once with `st.cache_resource`, and keep L1 working memory in `st.session_state`.
- Background retain threads must never call `st.*` functions; they write to SQLite, and the UI reads SQLite on the next rerun.

## 5. Backend logic

**One function, `orchestrator.run_turn()`, owns the whole loop; everything else is a small module it calls.** The user sees the reply as soon as it passes verification; extraction and retain happen afterwards in a background thread.

&#91;embedded content: The turn loop · 7 steps, 2 decisions, 2 loops\]

A reply that still fails after its one retry is shown anyway, with red chips, and the failure is recorded. The user is never blocked by the verifier.

**The loop, step by step:**

1. **Recall contract.** Merge L1 working memory (this session, instant) with L2 Hindsight recall (past sessions and teammates). De-duplicate by normalised text.
2. **Compose prompt.** Static system prompt first (so Groq's prompt cache can reuse it), then the rendered contract, then per-model patches, then the last 6 turns, then the user message. The contract replaces the full transcript, which is how Baton stays under Groq's 8K tokens-per-minute limit.
3. **Call the current model.** On HTTP 429, read `retry-after`, mark the model as cooling until then, log a handoff, and call the next model in the chain with the same contract.
4. **Verify with code.** Run the rejected-approach matcher and every enabled preference check (section 7).
5. **Repair.** For each failed check, move that preference one step up the patch ladder and retry once. Record pass or fail for that (model, preference, patch level).
6. **Show the reply** with its chips.
7. **Background: extract, redact, retain.** Classify the turn into typed items, scrub secrets, write them to L1 at once and to Hindsight asynchronously.

**The core, in Python:**

```python
def run_turn(session, user_msg):
    contract = memory.build_contract(session)            # L1 + L2 merged
    for model in llm.chain(session):                     # skips cooling models
        prompt = compose(contract, patches.for_model(model), session.window(6), user_msg)
        try:
            reply = llm.call(model, prompt)
        except RateLimited as e:
            llm.cool_down(model, e.retry_after)
            store.log_handoff(session, model, reason="429")
            continue                                     # the baton passes
        violations = verifier.check(reply, contract, session.prefs)
        if violations:
            patches.escalate(model, violations)
            reply = llm.call(model, compose(contract, patches.for_model(model), session.window(6), user_msg))
            violations = verifier.check(reply, contract, session.prefs)
        patches.record(model, violations)
        worker.submit(extract_redact_retain, session, user_msg, reply)
        return reply, violations
    return fallback.copyable_contract(contract)          # every model failed
```

**Repository layout:**

```text
baton/
  config.py        env vars, model chain, limits
  llm.py           Groq client, 429 handling, cool-downs
  memory.py        Hindsight wrapper + L1 working memory
  contract.py      Pydantic schemas, build, render to markdown
  extractor.py     turn -> typed items (structured output)
  verifier.py      deterministic checks registry
  patches.py       patch ladder and pass-rate stats
  redact.py        secret scrubbing
  store.py         SQLite access
  orchestrator.py  run_turn()
app.py             Streamlit UI
scripts/seed_demo.py   seeds past sessions for the demo
tests/             test_verifier.py, test_redact.py, test_contract.py
README.md  ARCHITECTURE.md  .env.example
```

**Optional HTTP API (P2, for a future browser extension):** `POST /chat`, `GET /baton/{session}` (JSON), `GET /baton/{session}.md` (Copy baton), `POST /handoff` (manual switch), `GET /ledger`, `POST /ledger/{id}/reverse`, `GET /stats/models`. Skip it tonight unless the core is done; Streamlit calls `orchestrator` directly.

## 6. Hindsight mechanism

**Hindsight is Baton's long-term memory: one bank per project, typed items retained after every turn, three parallel recalls at every handoff, and observations that turn per-model behaviour into learned beliefs.** A small in-process L1 cache covers the few seconds before Hindsight has indexed a new item.

**Plain-words refresher:** `retain` = write this down (Hindsight's LLM extracts facts, entities and dates). `recall` = find what I wrote about X (meaning, keyword, entity-link and time searches run in parallel). `reflect` = think over my notes and answer. An **observation** = a belief Hindsight consolidates from many facts, updated rather than overwritten when new evidence arrives.

### Bank setup (once per project)

```python
client.create_bank(
    bank_id=f"baton-{project}",
    name=f"Baton: {project}",
    mission=("I track the working state of a software project across AI models and teammates: "
             "goals, decisions, constraints, rejected approaches with reasons, next steps, "
             "and how each model behaves against the user's preferences."),
    disposition={"skepticism": 4, "literalism": 4, "empathy": 2},
)
```

Directives to add (hard rules for `reflect`; set through the Directives API, exact call to confirm in the docs): never store or repeat credentials; a rejected approach stays rejected until the user explicitly reverses it; cite the turn and model when stating a decision.

### What gets retained

Every item's content starts with a **kind tag in the text itself**, so the keyword search finds it even if metadata filtering isn't available.

| Kind | Example content | Retained when |
| --- | --- | --- |
| decision | `[DECISION] Use an in-process TTL cache for recall results` | The extractor finds a choice the user accepted |
| rejection | `[REJECTED] Redis. Reason: free tier. Aliases: redis, elasticache, redis cache` | The user turns an approach down |
| constraint | `[CONSTRAINT] Must stay on free tiers` | The user states a limit |
| next\_step | `[NEXT] Add 429 handling to llm.py` | End of each turn (latest wins) |
| open\_question | `[OPEN] Streamlit or FastAPI for the API layer?` | A question is left unresolved |
| preference | `[PREF] No bullet lists in answers` | The user states or edits a preference |
| model\_behavior | `[MODEL qwen] Violated no-bullets; patch level 2 fixed it` | After every verify and repair |
| handoff | `[HANDOFF] gpt-oss-120b to qwen after 429, 7 memories recalled` | Every model switch |

```python
client.retain_batch(
    bank_id=bank,
    items=[{"content": item.render(), "context": item.kind,
            "metadata": {"kind": item.kind, "model": model, "session": sid,
                         "turn": str(turn), "user": user}}
           for item in redact_all(items)],
    document_id=f"{sid}:{turn}",   # re-running a turn overwrites instead of duplicating (verify)
    retain_async=True,             # False only for the one live retain in the demo
)
```

### What gets recalled at a handoff

Three recalls run in parallel (`asyncio.gather` over `arecall`), each with its own token budget so one can't crowd out the others:

| Query | Types | Budget | Feeds |
| --- | --- | --- | --- |
| `goal, decisions, constraints and next step for {project}` | world, experience, observation | mid, 1,500 tokens | Contract fields |
| `rejected approaches and reasons` | world, observation | mid, 600 tokens | Rejection ledger |
| `how {model} follows the user's preferences` | experience, observation | low, 400 tokens | Starting patch level |

### Where reflect is used (never on the hot path)

- **"Why did we reject this?"** in the ledger: `reflect` answers from the bank, with sources.
- **End-of-session summary** written into the bank as a mental model, so tomorrow's first handoff starts from a curated brief.
- **Team digest:** "what did my teammate's sessions decide today?" across one project bank.

### The two-tier memory cache

|  | L1 working memory | L2 Hindsight |
| --- | --- | --- |
| Holds | Items from the current session | Everything: past sessions, teammates, model behaviour |
| Speed | Instant (Python dict + SQLite) | A recall round trip; new items take a few seconds to index |
| Why it exists | `retain_async` means a decision made 5 seconds ago may not be recallable yet | Cross-session, cross-model, cross-person memory, plus consolidation |
| Merge rule | L1 wins for the current session; L2 fills everything older. De-duplicate by normalised text. |  |

Think of it like a CPU cache in front of RAM: L1 is small and instant, L2 is big and a little slower, and the contract is built from both.

**Consolidation lag, again:** observations about each model are built by Hindsight's background worker. Run `scripts/seed_demo.py` hours before recording, or the Model learning tab will be empty on stage.

## 7. Structured validation

**Four things are validated by code, never by trusting an LLM: the extractor's output, the handoff contract, every model reply, and every item before it is retained.** This is the R&D-Agent(Q) rule applied to memory: the LLM proposes, a deterministic check decides.

### The handoff contract (Pydantic)

```python
class Rejection(BaseModel):
    approach: str
    reason: str
    aliases: list[str] = []          # e.g. ["redis", "elasticache", "redis cache"]
    turn: int
    model: str
    status: Literal["active", "reversed"] = "active"

class HandoffContract(BaseModel):
    goal: str
    constraints: list[str] = []
    decisions: list[str] = []
    rejected: list[Rejection] = []
    open_questions: list[str] = []
    next_step: str = ""

    def render(self) -> str: ...     # compact markdown for the prompt and Copy baton
```

### Extractor output

The extractor (`gpt-oss-20b`, a separate quota from the chat model) returns JSON through Groq structured outputs, validated against a `TurnItems` model with `model_validate_json`. On a validation error it retries once with the error text appended. If that fails too, Baton stores the raw turn only and shows an amber **extraction failed** chip. It never silently drops the turn.

### Verifier checks (the registry)

| Check | How code tests it | Evidence shown on the chip |
| --- | --- | --- |
| rejected-approach | Word-boundary match of the approach and its aliases; ignored if a negation ("not", "avoid", "instead of", "skip", "no") appears within 5 words before it | The matched sentence |
| no-bullets | Regex for lines starting with `-`, `*`, `•` or `1.` | Count of list lines |
| max-words | `len(reply.split()) <= N` | Word count against N |
| no-emojis | Unicode emoji ranges | The emojis found |
| no-preamble | First sentence doesn't match "Great question", "Sure", "Certainly", "Absolutely" | The opening words |
| code-language | Every fenced code block's language tag is in the allowed set (default: `python`, `bash`, `text`) | The offending tag |
| continuity (after a handoff only) | First reply doesn't ask what the project is ("what are you building", "can you share more about") | The matched question |

### The patch ladder (repair)

| Level | Patch | Why it works |
| --- | --- | --- |
| 0 | Preference listed in the contract | Enough for most models |
| 1 | Explicit rule in the system prompt: "Never use bullet lists." | Stronger wording |
| 2 | Same rule repeated at the end of the user message | Recency: the last instruction weighs most |
| 3 | Rule plus a one-line example of the required format, and an assistant prefill where Groq supports it | Shows rather than tells |

Baton picks, per (model, preference), the lowest level with a pass rate of at least 80% over 3 or more trials, and escalates on failure. Pass and trial counts live in SQLite; each outcome is also retained to Hindsight as a model\_behavior item.

### Redaction (before any retain and before Copy baton)

| Pattern | Catches |
| --- | --- |
| `gsk_[A-Za-z0-9]{20,}` | Groq keys |
| `sk-[A-Za-z0-9_-]{20,}` | OpenAI and Anthropic-style keys |
| `ghp_[A-Za-z0-9]{36}` | GitHub tokens |
| `AKIA[0-9A-Z]{16}` | AWS access key IDs |
| `eyJ[\w-]+\.[\w-]+\.[\w-]+` | JWTs |
| `(?i)(key\|token\|secret\|password)\s*[=:]\s*\S+` | `.env`-style lines |
| Email addresses | Personal data |

Matches become `[REDACTED:<type>]`. `tests/test_redact.py` holds one positive and one negative example per pattern; that test file is also good evidence for the Technical Implementation score.

## 8. Database and cache

**SQLite holds what needs exact lookups and numbers (messages, the ledger, check results, patch stats); Hindsight holds what needs meaning, time and consolidation.** No Postgres, no Redis: one file, `baton.db`, zero setup, and the demo never depends on a database server.

| Store | Owns | Why here |
| --- | --- | --- |
| SQLite | Transcripts, handoff log, verification results, patch pass rates, the current session's contract items | Exact queries and counts feed the chips and the learning chart |
| Hindsight | Every typed item across sessions, people and models; observations; mental models | Semantic, keyword, entity and time search, plus consolidation |
| In-process cache | Recall results and the rendered contract | Speed and Groq quota |

### Schema

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, project TEXT, user TEXT, created_at TEXT);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY, session_id TEXT, turn INTEGER, role TEXT,
  model TEXT, content_redacted TEXT, repaired INTEGER DEFAULT 0, created_at TEXT);

CREATE TABLE contract_items (          -- L1 working memory, durable
  id INTEGER PRIMARY KEY, session_id TEXT, kind TEXT, text TEXT,
  reason TEXT, aliases_json TEXT, turn INTEGER, model TEXT,
  status TEXT DEFAULT 'active', retained INTEGER DEFAULT 0);

CREATE TABLE verifications (
  id INTEGER PRIMARY KEY, message_id INTEGER, check_name TEXT,
  passed INTEGER, evidence TEXT, attempt INTEGER);

CREATE TABLE patch_stats (
  model TEXT, pref TEXT, level INTEGER, passes INTEGER, trials INTEGER,
  PRIMARY KEY (model, pref, level));

CREATE TABLE handoffs (
  id INTEGER PRIMARY KEY, session_id TEXT, from_model TEXT, to_model TEXT,
  reason TEXT, retry_after REAL, memories_recalled INTEGER, created_at TEXT);
```

The `retained` flag on `contract_items` flips to 1 when the background retain succeeds. Anything still at 0 on startup is retried, so a crash never loses a decision.

### Cache and speed tactics

| Tactic | Saves | How |
| --- | --- | --- |
| Recall cache | Hindsight round trips | `cachetools.TTLCache(maxsize=256, ttl=60)` keyed by `(bank, query, types)`; cleared for a bank whenever that bank gets a retain |
| Contract instead of transcript | Tokens, and so Groq TPM | Send the contract plus the last 6 turns, never the full history |
| Stable prompt prefix | Groq quota | Static system prompt first; [Groq doesn't count cached tokens toward rate limits](https://console.groq.com/docs/rate-limits) |
| Parallel recalls | Handoff latency | `asyncio.gather` over the three `arecall` queries |
| Background retain | Reply latency | `ThreadPoolExecutor(max_workers=2)`; the user never waits on Hindsight |
| Split quotas | 429s | Chat on `gpt-oss-120b`, extraction on `gpt-oss-20b`: separate per-model limits |
| SQLite WAL mode | UI and worker contention | `PRAGMA journal_mode=WAL;` so the UI can read while the worker writes |

## 9. API keys, models and configuration

**Two keys are required, Groq and Hindsight Cloud; two more are optional for real "Claude" and "GPT" labels.** All keys live in `.env`, which is in `.gitignore` from the first commit, because the repo must be public for submission.

| Key | Required | Where to get it | Used for |
| --- | --- | --- | --- |
| `GROQ_API_KEY` | Yes | [console.groq.com/keys](https://console.groq.com/keys) | Chat models, extractor |
| `HINDSIGHT_API_KEY` | Yes | Hindsight Cloud dashboard (apply code MEMHACK99 under billing for $50 credit) | retain, recall, reflect |
| `HINDSIGHT_BASE_URL` | Yes | Hindsight Cloud dashboard; the cloud API lives on `api.hindsight.vectorize.io` (confirm the exact base URL in the dashboard) | Client constructor |
| `ANTHROPIC_API_KEY` | No | Anthropic Console | Optional real Claude as Model A |
| `OPENAI_API_KEY` | No | OpenAI platform | Optional real GPT as Model B |

```bash
# .env.example  (commit this file; never commit .env)
GROQ_API_KEY=
HINDSIGHT_API_KEY=
HINDSIGHT_BASE_URL=https://api.hindsight.vectorize.io
BATON_PROJECT=demo
BATON_MODEL_CHAIN=openai/gpt-oss-120b,qwen/qwen3-32b
BATON_EXTRACTOR_MODEL=openai/gpt-oss-20b
BATON_HISTORY_WINDOW=6
BATON_MAX_REPAIRS=1
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
```

```python
client = Hindsight(base_url=os.environ["HINDSIGHT_BASE_URL"],
                   api_key=os.environ["HINDSIGHT_API_KEY"], timeout=30.0)
```

### Models and their free-tier limits

| Role | Model ID | Free limits (per [Groq's rate-limit page](https://console.groq.com/docs/rate-limits)) |
| --- | --- | --- |
| Model A (chat) | `openai/gpt-oss-120b` | 30 requests/min, 1,000/day, 8K tokens/min, 200K tokens/day |
| Model B (handoff target) | `qwen/qwen3-32b` from the problem statement; confirm it's still on your Groq Models page, else use the Qwen model listed there | Check your account's Limits page |
| Extractor | `openai/gpt-oss-20b` | 30 requests/min, 1,000/day, 8K tokens/min, 200K tokens/day |

**The 8K tokens-per-minute limit is both a risk and a gift.** A long prompt will hit it, which is exactly the real 429 the demo needs. That's why the contract replaces the transcript. Limits apply per organisation, so every teammate testing with one key shares the same quota: **use separate Groq keys per teammate during development**, and keep one fresh key for the demo.

## 10. Fallback chain, failure modes and edge cases

**Every failure must be visible on screen; a silent fallback turns the memory-ON demo into the memory-OFF demo without anyone noticing.** That's the team's known habit (a broad `except` returning a plausible default), so the rule is: catch narrowly, show a chip, log it.

**The fallback chain, in order:**

1. Model A (`gpt-oss-120b`).
2. Model B (the Qwen model) with the full contract.
3. Local Ollama, if it's installed and running.
4. No model at all: show the contract as a copyable block. The core value (your context, ready to paste anywhere) still ships.

For memory: Hindsight recall → L1 working memory only (with an amber **long-term memory unavailable** banner) → an empty contract with a red warning. Never an empty contract without the warning.

| Failure or edge case | What the user would see without handling | Handling |
| --- | --- | --- |
| 429 during the repair retry | Crash; the sketch in section 5 doesn't catch it | Wrap the retry in the same `RateLimited` handler; show the first reply with red chips |
| Stale rejection: user reverses "no Redis" at turn 20 | Baton fights the user | Extractor emits a `reversal` item; ledger status flips to reversed; the retained text records the reversal. **Test this on stage; judges will try it.** |
| Paraphrased rejected approach ("in-memory data store" for Redis) | Verifier misses it | Aliases generated at rejection time; aliases are editable in the ledger; the limitation is stated in the README |
| Extractor mislabels a rejection as a decision | "Uses Redis" gets stored | The contract is editable; a user correction is retained as a correction item |
| Hindsight slow or down | Handoff hangs | 5-second timeout on recall, then L1-only mode with the banner |
| Consolidation lag | Empty Model learning tab on stage | Seed hours before; the tab shows "no observations yet" instead of an empty chart |
| Duplicate retains after a rerun | Repeated items in the contract | `document_id=f"{sid}:{turn}"` plus normalised-text de-duplication in the merge |
| Streamlit double-submit on rerun | The same turn runs twice | Guard with a `turn_in_flight` flag in `st.session_state` |
| Memory poisoning: a pasted page says "ignore previous instructions" | That text is retained and injected into the next model | The extractor keeps only facts; the contract is rendered inside a block labelled as data, not instructions; Hindsight's [Memory Defense](https://hindsight.vectorize.io/developer/memory-defense) docs to check |
| Groq daily quota (1,000 requests) gone before the demo | No live demo | Fresh key reserved for the demo; the pre-recorded video is the backup |
| Secrets in chat | Keys stored in a third-party memory | Redaction runs before every retain and before Copy baton |

## 11. Build plan and timeline

**Freeze features at 11:00 Tuesday and submit by 18:00; the content deliverables take as long as the last third of the build.** Times are IST; the organisers' exact cutoff is still unconfirmed, so 18:00 is a safety margin, not the deadline.

&#91;embedded content: Build plan · 7 phases, 2 gates, Mon night to Tue 18:00 IST\]

Seeding before sleep is deliberate: Hindsight consolidates observations in the background, so the Model learning tab is populated by morning. If anyone is in class during the day, phases 5 to 7 go to whoever is free; assign owners tonight.

**Severity-first triage. Work top down; never start a P1 while a P0 is open.**

P0: without these, the submission fails or the demo doesn't work.

- [ ] Every member has filled the Profile Review Form
- [ ] `.env` in `.gitignore`; repo public
- [ ] One retain and one recall against the project bank work
- [ ] Chat works on Model A; a 429 (or the manual switch) hands off to Model B
- [ ] Contract is recalled and injected; memory ON/OFF toggle works
- [ ] Rejected-approach verifier flags a re-suggestion
- [ ] YouTube video, each member's article, LinkedIn post and Reddit link, with no mention of the word hackathon anywhere

P1: what makes it win.

- [ ] Repair retry with the patch ladder and pass-rate stats
- [ ] Rejection ledger and Memory trace tabs
- [ ] Copy baton button
- [ ] Redaction with tests
- [ ] Seeded history and the Model learning chart

P2: only if P1 is done.

- [ ] Team view (who decided what)
- [ ] "Why did we reject this?" via reflect
- [ ] Optional FastAPI endpoints

## 12. Tech debt and v2 roadmap

**Six shortcuts are accepted knowingly tonight; each goes in the README's Limitations section, which the content guide also asks for as an honest lesson.**

| Debt | Why accepted | v2 fix |
| --- | --- | --- |
| Keyword-and-alias rejection matcher | Deterministic and explainable | Embedding similarity with a threshold, still no LLM judge |
| Pass-rate patch selection | Honest with little data | Thompson-sampling bandit, as in R&D-Agent(Q), once there are enough trials |
| Groq open models stand in for Claude and GPT | Free tier; real 429s | Real vendor keys behind the same `llm.py` interface |
| Own chat app, not inside claude.ai | No JavaScript tonight | Browser extension, or a Python MCP server so Claude Desktop pulls the baton directly |
| No auth; project name picks the bank | Demo scope | Per-team accounts and bank permissions |
| Extractor labels are sometimes wrong | One LLM call per turn | User corrections retained as training signal; editable contract already in place |

**v2, in priority order:** a browser extension that injects the baton into claude.ai and chatgpt.com; the team view with per-person decision history; the bandit; embedding-based rejection matching.

## 13. v3 backlog (noted 30 Sep)

**v2 moved Baton from owning the model call to being a cooperative MCP tool; v3's job is to win enforcement back and prove the value with numbers.** The v2 fixes come first because they block the demo or open a security hole.

### v2 fixes before the finale

| Issue | Why it matters | Fix |
| --- | --- | --- |
| ChatGPT write actions need Business, Enterprise or Edu; Pro is read/fetch only ([OpenAI](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt)) | The ChatGPT lane may not write on a personal plan | Import box is the primary ChatGPT path; MCP writes shown as "works on Business plans"; rehearse the write-confirmation dialog |
| `check_reply` is voluntary | The model decides whether to verify itself; skipped replies are invisible to Baton | Show **check coverage** (checks ÷ pulls) on the Bridge page and report it honestly |
| Public MCP endpoint with no auth | Anyone with the tunnel URL reads or writes the contract | Bearer token (or secret path, flagged as debt) |
| `record_items` accepts any model's write | Memory poisoning: a web page read by Claude can plant a fake decision ([OWASP MCP tool poisoning](https://owasp.org/www-community/attacks/MCP_Tool_Poisoning)) | `source` on every item (client, turn), shown on the timeline, one-click revoke |
| Two lanes write at once | Last-writer-wins silently drops a `next_step` | Contract = projection of the append-only bridge event log |
| Several projects, one phrase | "pick up the baton" may load the wrong bank | Default to last-used project; `pull_baton` names the project it loaded |

### v3 features, severity-first

- [ ] **P0 Evidence:** handoff eval set of \~30 scripted sessions; metrics: continuity, rejections respected, check coverage, per client
- [ ] **P0 Trust:** item provenance, user confirmation for rejections and reversals, append-only event log
- [ ] **P1 Enforcement:** OpenAI-compatible gateway proxy (Cursor, Cline, Aider point their base URL at it) so every reply passes the verifier
- [ ] **P1 Matching:** paraphrase-aware rejection matching (embeddings + negation), measured for precision and recall on a labelled set
- [ ] **P2 Handoff Lab:** R&D-Agent(Q)-style loop that backtests briefing strategies on the eval set

| Integration route | Enforced? | Covers | Effort |
| --- | --- | --- | --- |
| MCP bridge (v2) | No, voluntary | claude.ai, Claude Desktop, ChatGPT Business | Done |
| Gateway proxy | Yes, every reply | IDE and API tools | Medium, Python |
| Browser extension | Captures only, can't block | claude.ai, chatgpt.com | High, JavaScript, brittle DOM |

## 14. SDLC research: where the pain actually is

**Across the software lifecycle, the recurring problem is not that context gets lost; it's that decisions aren't enforced when the next change happens.** Memory tools already solve storage. Baton's verifier is the part that solves enforcement, so that's the part to grow.

The strongest single data point: in [20,574 real coding-agent sessions](https://arxiv.org/html/2605.29442v2), constraint violations were the most common misalignment (38.33%), 91.49% of visible resolutions still needed an explicit user correction, and constraint violations *grew* as a share of failures over time. The second most common failure was inaccurate self-reporting (22.58%), which is exactly why a model checking itself through `check_reply` can't be trusted on its own.

| Stage | Problem | Evidence | What Baton's engine could do | Effort |
| --- | --- | --- | --- | --- |
| Specs and planning | Specs drift from code; nobody knows what the code looked like when a spec was written | Open [Kiro backlog issue](https://github.com/kirodotdev/Kiro/issues/9435); [SpecGov's `SPEC_IMPACT_MISSING` check](https://dev.to/paladini/your-specs-are-lying-how-to-detect-documentation-drift-in-every-pull-request-41p7) | Anchor each decision to the git commit it was made at; flag decisions whose files have changed since | Medium |
| Architecture | ADRs are written and never read; stale ones actively mislead | ["Static, point-in-time documents asked to perform a living-artefact function"](https://www.javacodegeeks.com/2026/05/the-reason-most-architecture-decision-records-get-written-and-never-read-is-architectural-not-cultural.html); the proposed fix is coupling decisions to executable enforcement | The ledger as living ADRs: decisions and rejections with supersession history in Hindsight, checked at change time | Low: mostly built |
| Coding with agents | Agents break stated constraints; users correct them by hand | [38.33% constraint violations; 91.49% need user correction](https://arxiv.org/html/2605.29442v2) | Verifier on every reply | Done in v1 |
| Agent self-reports | Agents misreport what they did | [22.58% inaccurate self-reporting](https://arxiv.org/html/2605.29442v2) | Verify outside the model (gateway, CI), not by asking it | Medium |
| Stale context | An outdated context file produces confident, wrong code (JWT middleware after a move to OAuth) | [Augment Code](https://www.augmentcode.com/guides/why-ai-agents-repeat-questions) | Reversal events: recall returns the current decision and marks the old one superseded | Low |
| Code review | AI-heavy teams merge more and bigger PRs; review becomes the bottleneck | [Faros, 10,000+ developers: review time +91%, PR size +154%, bugs +9%](https://www.faros.ai/blog/ai-software-engineering) | A CI check that compares a PR diff against the ledger and comments with the reason and source | Medium |
| Delivery stability | AI adoption links to higher throughput but lower stability; control systems are the fix | [DORA 2025](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report); 30% have little or no trust in AI code | Pitch Baton as a control system for decisions | Pitch only |
| Knowledge search | 61% of developers spend over 30 minutes a day searching for answers | Stack Overflow 2024, via [Sourcegraph](https://sourcegraph.com/blog/developer-onboarding) | "Why is it like this?" answered by `reflect` over the ledger | Low |

**The reframe for the pitch:** "Memory stores what you decided. Baton enforces it on the next change, whoever or whatever makes it."

### Recommended v3 extension: Decision Guard for pull requests

A GitHub Action reads the project's ledger and checks each PR diff against active rejections and constraints. Example: a PR adds `redis` to `requirements.txt` while "Redis: rejected, free tier" is active, so the check comments with the reason, the date, and whether a person or which model recorded it. Whether the author overrides or accepts it is retained to Hindsight, so the guard learns which rules the team actually stands by.

| Extension | Evidence behind it | Deterministic? | Demo value | Effort |
| --- | --- | --- | --- | --- |
| **Decision Guard for PRs** | Review bottleneck, constraint violations | Yes: dependency files and imports, high precision | High: a red check on a real PR | Medium, Python |
| Gateway proxy | Constraint violations, self-reporting | Yes, per reply | Medium | Medium |
| Git-ref drift anchoring | Spec drift | Yes | Medium | Medium |
| Onboarding Q&A via reflect | Search time | No, LLM answer | Low: looks like every RAG demo | Low |

**Habit check:** don't try to cover every stage. Pick one extension (Decision Guard) and measure it; breadth across the lifecycle will read as a slide, not a product.

**Evidence caveats:** Faros and Augment sell tools in this space; the 20,574-session study is a preprint; Augment's "19% slower" figure comes from a 2025 study of 16 developers. Use the numbers, but name the source when you quote them.

## 15. Decision Guard: design and build plan

**Decision Guard is a GitHub check that fails or flags a pull request when its diff contradicts an active decision in Baton's ledger, and learns from how the author responds.** It extends the same rule as the reply verifier: an LLM may propose a rule, a person confirms it, and plain code enforces it.

It also joins Baton's two halves. A rejection made in a ChatGPT or Claude chat becomes a check on real code, and an override on a PR becomes a new decision that the next model pulls.

&#91;embedded content: Decision Guard loop · ledger to PR check and back\]

The checker is the accent box because it's the only step that decides pass or fail, and it never calls a model.

### Rule types

Only rule kinds that code can check with high precision can block a merge. Everything fuzzier is advisory.

| Kind | Comes from | How the diff is checked | Example | Can block? |
| --- | --- | --- | --- | --- |
| `forbidden_dependency` | A rejected library or service | Added lines in manifest files only: `requirements.txt`, `pyproject.toml`, `package.json`, `go.mod` | `redis==5.0` added while "Redis: rejected" is active | Yes |
| `forbidden_import` | A rejected library | Added lines in `.py`, `.js`, `.ts` matching import patterns | `import redis`, `from 'redis'` | Yes |
| `protected_path` | A constraint ("don't touch migrations by hand") | Changed file paths against globs | `migrations/0012_*.py` edited | Yes |
| `forbidden_text` | A constraint with no better shape | Regex on added code lines | A hard-coded paid API endpoint | Warn only |
| `drift_watch` | Any decision anchored to a commit | Files in the decision's scope changed since that commit | "Cache design decided at `a1b2c3d`; 3 files changed since" | Warn only |

### The rule schema

```python
class GuardRule(BaseModel):
    id: str                                   # "rej-redis"
    decision_id: str                          # ledger item it was compiled from
    kind: Literal["forbidden_dependency", "forbidden_import",
                  "protected_path", "forbidden_text", "drift_watch"]
    targets: list[str]                        # ["redis", "redis-py", "aioredis"]
    paths: list[str] = ["**"]                 # globs the rule applies to
    reason: str                               # "free tier; use in-process TTL cache"
    severity: Literal["block", "warn"] = "warn"
    source: str                               # "user:rahul" | "model:claude" | "import:chatgpt"
    anchored_commit: str | None = None
    status: Literal["proposed", "active", "overridden", "retired"] = "proposed"
```

### The rule compiler: proposed, then confirmed

1. When a rejection or constraint lands in the ledger, the extractor model proposes a `GuardRule` as structured JSON, including aliases (`redis`, `redis-py`, `aioredis`).
2. The rule appears on the Bridge page as **proposed**. One click by a person makes it **active**.
3. Only active rules with `severity="block"` can fail a check. Proposed rules only warn.

This is also the defence against memory poisoning: a fake decision planted by a web page can at most produce a warning, never a blocked merge.

### The checker

1. Get the diff: `git diff --unified=0 origin/<base>...HEAD`, parsed into added lines per file. Removed lines are ignored, because removing Redis is fine.
2. For each active rule whose path globs match, run that kind's checker. Dependency names are normalised (lowercase, `-` and `_` treated alike) before comparison.
3. Each hit becomes a `Violation(rule_id, file, line, evidence)`.
4. Report as GitHub annotations on the exact lines (`::error file=requirements.txt,line=14::...`) plus one PR comment, updated in place rather than posted again on every push.
5. Exit 1 only if a blocking violation isn't overridden. If the checker itself crashes, report the check as errored, never as passed.

### Override and learning loop (where Hindsight earns its place)

1. **Override:** the author adds the label `baton-override`, or comments `/baton override rej-redis reason: moving to paid tier`. The check re-runs and passes, and the override is logged with its reason.
2. **Retain:** every trigger, fix and override is retained as a `guard_outcome` item, e.g. `[GUARD] rej-redis triggered on PR #12; author overrode: moving to paid tier`.
3. **Reversal:** an override with a reason is itself a decision. It becomes a reversal event in the ledger, so the next model that pulls the baton knows Redis is now allowed.
4. **Learn:** when a rule is overridden twice, the Bridge page suggests retiring it. Hindsight's observations capture the shift ("the team no longer holds the Redis rejection"), and the PR comment can link a `reflect` answer to "why was this rule created?"

### Where the Action gets its rules

| Option | Pros | Cons |
| --- | --- | --- |
| **Committed `.baton/rules.json` (recommended)** | Works with no Baton server running; rule changes are themselves reviewed in PRs | Stale until someone exports again |
| Live API `GET /guard/rules` | Always current | CI depends on your server and tunnel being up; needs a repo secret |

Fallback chain: live API if `BATON_URL` is set, else the committed file, else a **neutral** check saying "no rules found". It never passes silently.

### Files and endpoints

```text
baton/guard/
  rules.py       GuardRule schema, compiler (propose), confirm/retire
  diff.py        git diff -> added lines per file
  checkers.py    one function per rule kind
  report.py      annotations + single updatable PR comment
  cli.py         python -m baton.guard check --base origin/main
.baton/rules.json
.github/workflows/baton-guard.yml
tests/test_guard.py
```

New endpoints: `GET /guard/rules?project=`, `POST /guard/rules/{id}/confirm`, `POST /guard/outcome`. New Bridge page panel: proposed rules with a Confirm button, and a lane for PR events on the timeline.

### The workflow

```yaml
name: Baton Guard
on:
  pull_request:
    types: [opened, synchronize, reopened, labeled, unlabeled]
permissions:
  contents: read
  pull-requests: write
jobs:
  guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: pip install -e .
      - run: python -m baton.guard check --base origin/${{ github.base_ref }} --rules .baton/rules.json
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          BATON_URL: ${{ secrets.BATON_URL }}
          BATON_TOKEN: ${{ secrets.BATON_TOKEN }}
```

The `/baton override` comment needs a second trigger on `issue_comment`; for the MVP, the label is enough. Never switch to `pull_request_target` with a checkout of the PR's code: that runs untrusted code with write access.

### Demo act 6: one ledger, three lanes

1. In the chat lane, Redis is rejected (already in the demo).
2. On the Bridge page, the proposed rule `rej-redis` appears; one click confirms it.
3. Open a PR adding `redis==5.0` to `requirements.txt`. The Baton Guard check goes red on that exact line, with the comment: "Redis rejected by Rahul via ChatGPT: free tier. Override with the `baton-override` label."
4. Add the label with a reason. The check goes green, the ledger shows a reversal, and Claude's next `pull_baton` says Redis is now allowed.

### Edge cases

| Case | Handling |
| --- | --- |
| Package aliases (`redis`, `redis-py`, `aioredis`) | `targets` holds aliases; names normalised before matching |
| Lock files (`poetry.lock`, `package-lock.json`) | Ignored: manifests only, to avoid noise |
| Removing a forbidden dependency | Only added lines are checked |
| README or comments mention Redis | Blocking kinds only look at manifests and imports |
| PR from a fork | No secrets and a read-only token: fall back to the committed file, annotate instead of commenting |
| Very large diff | Cap files checked; report "partial check" instead of passing |
| Poisoned or wrong rule | Only person-confirmed rules can block |
| Guard crashes | Check reported as errored, visible on the PR |

### MVP versus full build

| Scope | Includes | Effort |
| --- | --- | --- |
| **MVP (before the finale)** | `forbidden_dependency` + `forbidden_import`, committed rules file, label override, annotations, one comment, outcome retained to Hindsight, tests | \~4 h |
| Full | Rule compiler with Bridge confirm UI, `/baton override` comments, live API, `protected_path`, `drift_watch`, retire-after-2-overrides suggestion | \~9 to 10 h more |

**Order:** finish and submit v2 first. Build the MVP only after the video and posts are done, then add it to the finale demo as act 6.

## Sources

- [Hindsight overview](https://hindsight.vectorize.io/) and [Python client](https://hindsight.vectorize.io/sdks/python)
- [Hindsight quick start](https://hindsight.vectorize.io/developer/api/quickstart)
- [Hindsight ChatGPT integration](https://hindsight.vectorize.io/sdks/integrations/chatgpt)
- [Groq rate limits](https://console.groq.com/docs/rate-limits)
- [R&D-Agent-Quant paper (arXiv 2505.15155)](https://arxiv.org/pdf/2505.15155) and [microsoft/RD-Agent](https://github.com/microsoft/rd-agent)
- [OpenMemory Chrome Extension](https://www.producthunt.com/products/openmemory-chrome-extension) and [Supermemory extension](https://github.com/supermemoryai/supermemory/pull/418)
