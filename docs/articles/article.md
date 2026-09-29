# Rebuilding Typed State from Hindsight Metadata Instead of Text

When an LLM hits a 429 rate limit or gets swapped out mid-task, stuffing a 40-turn conversational transcript into a fresh model usually fails. The incoming model gets buried in conversational filler, hallucinates around discarded ideas, and re-proposes solutions you rejected twenty minutes ago.

We built Baton to solve that continuity problem across multi-model workflows. Instead of replaying bloated prompt histories when handing off tasks between Groq, Gemini, and local models, Baton extracts the hard engineering state—goals, settled decisions, architectural constraints, and rejected approaches with reasons—into a typed contract. When a model fails or is intentionally switched, the next model receives that contract in its system prompt rather than the raw chat log.

Making this work in production required rethinking how we handled memory. Off-the-shelf vector search and naive semantic summaries proved too fuzzy: an internal summarizer would turn an explicit rejection into a generic mention, causing the next model to repeat the mistake. Here is how we designed a two-tier memory architecture using SQLite and [Hindsight](https://hindsight.vectorize.io/), why we rebuild typed state from metadata rather than recalled text, and how two engineers divided and built the system.

---

## The System: State Contracts Over Conversational Sludge

When developers collaborate, they do not hand a new teammate a raw recording of a two-hour whiteboard session. They hand them an architectural decision record (ADR) or a concise spec: "We are building X. We decided on Y. We explicitly rejected Z because of latency."

Baton enforces this pattern programmatically between models through a 7-step turn loop:

```text
User Input ──► Recall (L1 + L2) ──► Compose Prompt ──► Model Call
                                                           │
                                                      (429 / Error)
                                                           ▼
Feedback ◄── Retain (Hindsight) ◄── Extract ◄── Verify ◄── Handoff
```

1. **Recall**: Pull active state from SQLite (L1) and historical context from Hindsight (L2).
2. **Compose**: Inject a formatted `<baton_contract>` into the model's system prompt alongside user preferences.
3. **Call**: Dispatch the turn to the active model (e.g., `gpt-oss-120b` on Groq).
4. **Handoff (if needed)**: On a 429 rate limit or manual switch, cool the failing model and reroute the contract to the next model in the chain (e.g., `gemini-3.5-flash`).
5. **Verify**: Deterministic code checks scan the generated response. If the model proposed a rejected technology or violated formatting rules, a single repair retry fires.
6. **Extract**: A fast utility model extracts newly established goals, decisions, constraints, or rejections from the completed turn.
7. **Retain**: Persist the delta back to local SQLite and dispatch an asynchronous retain to long-term memory.

The core insight is that conversational context is ephemeral, but architectural state is durable. To make this durable state reliable across sessions and machines, we needed an [agent memory architecture](https://vectorize.io/what-is-agent-memory) that offered semantic recall without corrupting our typed contracts.

---

## The Problem with LLM Memory Summarization

Most agent memory frameworks treat memory as an unformatted bag of text chunks embedded into a vector database. When you query the store, you get a block of text that an LLM summarizes before injecting it into your prompt.

In a software engineering workflow, that summarization is catastrophic. Consider this extracted item:

```text
[REJECTED] Redis
Reason: Connection pool exhaustion under serverless container scale-to-zero.
```

If your memory store passes that line through an internal LLM summarizer during ingestion or retrieval, the text frequently degrades into:

> *"The user and assistant evaluated caching strategies, including Redis and memory stores."*

The negative constraint is gone. When Groq hits a token ceiling and Gemini takes over the task, Gemini reads that summary and immediately says: *"Let's set up a Redis instance to handle session caching."*

To maintain strict continuity, we had two non-negotiable requirements:
1. **Zero Text Drift**: The memory layer must return the exact item ID, item kind, reason, and aliases that were recorded.
2. **Deterministic Resiliency**: If remote memory times out or exhausts its credits, the local session must degrade gracefully to local disk without crashing or silently losing the contract.

We divided the implementation cleanly between two engineers: one focused on the memory infrastructure and multi-model pipeline, while the other built the deterministic verification engine, the turn loop, and the reactive user interface.

---

## Track 1: The Resilient Memory Engine and Multi-Model Provider Pipeline

The first half of the build focused on the data tier: building a resilient two-tier memory hierarchy with [Hindsight's open-source library](https://github.com/vectorize-io/hindsight) and integrating multi-provider model chains.

### 1. Rebuilding State from Metadata, Never Recalled Text

Hindsight provides bank-level configuration for memory retention and multi-strategy recall (semantic, BM25 keyword, entity graph, and temporal fusion). To guarantee that our contracts remained tamper-proof, we configured our project memory banks with `retain_extraction_mode="verbatim"`:

```python
async def _ensure(self, client: Any, project: str) -> None:
    bank = _bank_id(project)
    await client.acreate_bank(
        bank_id=bank,
        name=f"Baton: {project}",
        mission=_MISSION,
        disposition={"skepticism": 4, "literalism": 4, "empathy": 2},
        retain_extraction_mode="verbatim",
        enable_observations=True,
        observations_mission=_OBSERVATIONS_MISSION,
    )
```

Even with verbatim extraction, relying on string parsing of recalled narrative text is brittle. Hindsight accepts a `metadata` dictionary of type `dict[str, str]` on every retained item. Instead of treating Hindsight as an opaque document store, we serialized our complete typed `Item` domain model into that metadata payload:

```python
def _metadata(item: Item) -> dict[str, str]:
    return {
        "item_id": item.id,
        "kind": item.kind.value,
        "text": item.text,
        "reason": item.reason or "",
        "aliases": json.dumps(item.aliases),
        "check_id": item.check_id.value if item.check_id else "",
        "supersedes": item.supersedes or "",
        "session": item.session_id,
        "project": item.project,
        "user": item.user,
        "turn": str(item.turn),
        "model": item.model or "",
        "source": item.source,
        "created_at": item.created_at.isoformat(),
    }
```

When we query Hindsight during session startup or model handoff, we throw away the recalled narrative text entirely. We reconstruct the contract directly from the structured metadata:

```python
def _item_from_metadata(metadata: dict[str, str]) -> Item | None:
    try:
        aliases_val = json.loads(metadata.get("aliases", "[]"))
        return Item(
            id=metadata["item_id"],
            kind=ItemKind(metadata["kind"]),
            text=metadata["text"],
            reason=metadata.get("reason") or None,
            aliases=tuple(str(v) for v in aliases_val),
            session_id=metadata["session"],
            project=metadata["project"],
            user=metadata["user"],
            turn=int(metadata["turn"]),
            model=metadata.get("model") or None,
            source=metadata.get("source", "extractor"),
            created_at=datetime.fromisoformat(metadata["created_at"]),
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None
```

Because the contract is reconstituted from immutable key-value metadata, zero drift occurs. A decision made by Claude or GPT-OSS three days ago enters Gemini's prompt with its exact wording and rationale intact.

### 2. Taming Asyncio Client Lifecycles on Background Threads

The `hindsight-client` Python SDK uses an `asyncio` event loop under the hood. In a web backend where requests originate across worker threads, sharing an async client across threads frequently causes fatal `"Task attached to a different loop"` runtime errors.

Rather than letting thread pools spawn ad-hoc event loops or blocking the main HTTP turn loop during remote network calls, this track isolated Hindsight onto a dedicated daemon thread running its own persistent event loop:

```python
class MemoryService:
    """Own an asyncio loop and Hindsight client on one dedicated daemon thread."""

    def __init__(self, client_factory: Callable[[], Any]) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._client: Any | None = None
        self._ready = threading.Event()
        self._thread = threading.Thread(target=self._run, name="baton-hindsight", daemon=True)
        self._thread.start()
        self._ready.wait(10.0)

    def _run(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._loop = loop
        self._client = self._client_factory()
        self._ready.set()
        loop.run_forever()

    def submit(self, operation: Callable[[Any], Awaitable[T]], timeout: float) -> T:
        future = asyncio.run_coroutine_threadsafe(operation(self._client), self._loop)
        return future.result(timeout=timeout)

    def fire(self, operation: Callable[[Any], Awaitable[Any]]) -> None:
        asyncio.run_coroutine_threadsafe(operation(self._client), self._loop)
```

This pattern unlocked two major operational wins:
- **Fire-and-Forget Retains**: Memory retains never add latency to the user-facing response. The turn loop commits to local SQLite immediately and fires a background task to Hindsight.
- **Hard Timeouts with Graceful Fallback**: Enforcing a strict 5.0-second timeout allows the system to fail over cleanly to local SQLite L1 with an amber `LTM_UNAVAILABLE` alert if remote memory experiences latency spikes.

---

## Track 2: The Contract Engine, Deterministic Verification, and the Relay Interface

While the first engineer hardened memory persistence and provider adapters, the second engineer tackled the client-facing orchestrator: contract rendering, deterministic verification, secret redaction, and the interactive relay dashboard.

### 1. Deterministic Verifiers: Trust, but Verify

Even with a pristine system prompt, language models will occasionally ignore negative constraints. If you tell an LLM "do not use Redis," there is a non-zero probability it will suggest Redis anyway.

Rather than relying on another stochastic LLM call to judge the primary model's output, this track implemented a deterministic verifier. Before any response reaches the user, it is evaluated against the rejection ledger using regex scans and negation detection:

```python
def _rejected(reply: str, state: ContractState) -> CheckResult:
    if not state.rejections:
        return CheckResult(check_id=CheckId.REJECTED, status="n/a")
        
    for item in state.rejections:
        for alias in (item.text, *item.aliases):
            pattern = re.compile(rf"(?<!\w){re.escape(alias)}(?!\w)", re.IGNORECASE)
            for match in pattern.finditer(reply):
                before = re.findall(
                    r"[\w']+", reply[max(0, match.start() - 80):match.start()].casefold()
                )[-5:]
                negated = bool(_NEGATE_BEFORE.intersection(before))
                if not negated:
                    return CheckResult(
                        check_id=CheckId.REJECTED,
                        status="fail",
                        detail=f"Mentioned rejected approach '{alias}' without negation.",
                    )
                    
    return CheckResult(check_id=CheckId.REJECTED, status="pass")
```

If a model fails verification, Baton initiates an automated repair loop. It reprompts the model once with the exact failure: *"Your response violated the contract by proposing Redis, which was rejected on Turn 3. Rewrite without it."* In testing, this single repair retry achieved near-100% compliance.

### 2. Secret Redaction and the Relay User Interface

To prevent credentials from leaking into long-term memory or prompt histories, this track built a comprehensive pre-storage redactor covering API keys (Groq, Google, OpenAI), JWTs, AWS credentials, and `.env` formats.

On top of the FastAPI backend, we implemented a responsive interface using React 19, Vite, and Tailwind CSS v4 dubbed "Night Relay":
- **Relay Top Bar**: Visualizes the active model carrying the baton, countdown timers for cooling models, and one-click manual handoffs.
- **Contract & Ledger Inspector**: Gives engineers instant visibility into active goals, constraints, and rejection items, with one-click "Copy Baton" to export the markdown ADR directly to git or issue trackers.
- **3D Handoff Visualizer**: Uses `react-three-fiber` to render a 3D particle path tracking state transitions across models in real time.

---

## What It Looks Like in Practice

Here is a real example from a multi-model development session using Baton.

### Turn 1: The Initial Decision
The user is working with `openai/gpt-oss-120b` on Groq to design an authentication store:

> **User**: *"Let's build the auth layer. Should we use Redis for token storage or SQLite with WAL mode?"*  
> **Assistant**: *"For a local-first desktop app, Redis introduces an unnecessary Docker dependency and port conflict risks. Let's use SQLite in WAL mode with a 5000ms busy timeout."*

At the end of the turn, the extractor parses the output and stores two items in Hindsight and SQLite:
- `[DECISION]` SQLite in WAL mode for auth tokens.
- `[REJECTION]` Redis (Reason: Requires external Docker service; introduces port contention).

### Turn 2: The 429 Handoff
Two turns later, the user requests a complex SQL migration script. Groq's rate limiter fires:

```json
HTTP 429 Too Many Requests: Rate limit reached for model `openai/gpt-oss-120b`
```

Baton intercepts the 429. It marks `gpt-oss-120b` as cooling down for 60 seconds, shifts the active baton to `gemini-3.5-flash`, and injects the contract assembled from Hindsight:

```xml
<baton_contract>
Goal: Build local-first auth store
Decisions:
  - SQLite in WAL mode for auth tokens (Turn 1, gpt-oss-120b)
Rejected Approaches:
  - Redis: Requires external Docker service; introduces port contention (Turn 1)
Next Step: Write SQL migration script for user sessions
</baton_contract>
```

Gemini generates the SQL migration script seamlessly. It does not ask *"What database are you using?"* nor does it say *"Here is how you can do this in Redis."* It continues the work as if it had been the sole model in the conversation from the beginning.

---

## Lessons Learned

Building a multi-model handoff engine with persistent memory taught us several concrete lessons about engineering agent systems:

### 1. Separate State Extraction from Turn Generation
Never ask your primary conversational model to manage its own state contract while generating application logic. It pollutes its reasoning and inflates token cost. Using a fast, small model (like `gemini-3.5-flash-lite` or `gpt-oss-20b`) purely as an asynchronous extractor produces cleaner, schema-strict JSON without adding turn latency.

### 2. Don't Let LLMs Police Themselves
Semantic memory recall gives models the context they need, but it does not guarantee compliance. If an architectural decision is mission-critical (e.g., *"never commit credentials"*, *"never use Mongo"*), verify it with deterministic code. Fast regex scans and AST checks running outside the LLM context window are cheaper, faster, and 100% reliable.

### 3. Store Schemas in Key-Value Metadata
Vector embeddings are lossy by definition. If you need to store typed domain objects inside long-term memory, keep the raw text clean for semantic similarity, but embed your full JSON payload inside the vector store's metadata fields. Rebuilding from metadata guarantees deterministic schema deserialization.

### 4. Isolate Asynchronous SDKs
When bridging async libraries like the [Hindsight documentation](https://hindsight.vectorize.io/) describes into synchronous web backends or UI frameworks, do not fight the event loop. Pin the async client to a dedicated daemon thread with a single, long-lived event loop. You eliminate thread-attachment bugs, centralize request cancellation, and make fire-and-forget background ingestion trivial.

### 5. Two Tiers Are Better Than One
Relying entirely on remote cloud memory creates an unnecessary single point of failure for local workflows. Combining local SQLite L1 storage with remote Hindsight L2 storage gives you the best of both worlds: zero-latency local state that never fails, paired with durable, cross-machine recall that lets teams hand off tasks without missing a beat.

---

*The full implementation of Baton's contracts, two-tier cache, and model orchestrator is available on our repository, along with tests covering the model chain and Hindsight client integration.*
