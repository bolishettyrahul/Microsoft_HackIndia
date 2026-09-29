# Baton: work sectors and handoff contracts

- **Date:** 2026-09-29
- **Status:** Draft for review
- **Builds on:** `2026-09-29-baton-design.md` (the design spec)

## 1. Why this document exists

Baton v1 will be built in parallel, one git worktree per sector. Parallel builds usually break at integration in one of three ways: two branches edit the same file, one side changes a signature the other side depends on, or a module is written against its own assumptions instead of its neighbour's. This document prevents all three:

- **Sectors own disjoint files,** so no two branches ever edit the same file.
- **A handoff contract at every sector boundary** fixes the exact types, signatures, errors and threading rules. Sector 0 commits them as code to `baton/interfaces/` before any other sector starts.
- **Every contract has a fake and a contract test.** Each sector builds against its neighbours' fakes. Before merging, it proves its real implementation behaves like the fake.

**Two meanings of "handoff contract".** Baton's product feature is also called a handoff contract: the `HandoffContract` block of goal, decisions and rejections. To keep them apart, this document calls the boundary agreements **sector contracts**, and their code lives in `baton/interfaces/`.

## 2. Rules

1. **Contracts land first.** Sector 0 merges `baton/interfaces/` (types, protocols, errors, views and fakes) and `tests/contracts/` to `main` before any other sector writes code.
2. **Import only through interfaces.** A sector's code imports other sectors only through `baton.interfaces`. There are two exceptions:
   - The orchestrator imports the engine's pure functions directly (§5.2). They have no side effects, so they need no fake.
   - `baton/orchestrator/wiring.py`, the composition root, builds the real objects.
   - `app.py` imports `build_baton` from that wiring module.

   `tests/contracts/test_boundaries.py` scans the imports and fails on any other cross-sector import.
3. **Edit only files you own** (§4). `scripts/check_ownership.py <sector>` fails if the branch touched a file outside its sector. It runs before every merge.
4. **Build against fakes.** Every protocol has a fake in `baton/interfaces/fakes/`. Until integration, a sector's tests use fakes for its neighbours, never their real code.
5. **Contract tests decide.** `tests/contracts/` has one suite per protocol, written against the protocol rather than any implementation. It runs against the fake in Sector 0 and against the real implementation in the owning sector. A sector merges only when its real implementation passes.
6. **Contracts change only on `main`.** A change is one commit to `main` that updates the protocol, the fake, the contract tests and `CONTRACT_VERSION` together. Every open sector branch rebases that same day. An additive change (a new optional field or a new method) bumps the minor version. Anything else bumps the major version and needs the agreement of every sector that consumes the contract.
7. **No broad `except`.** `except Exception` and a bare `except:` are allowed in only two files: the provider adapter (`baton/llm/provider.py`) and the memory service (`baton/memory/service.py`). Everywhere else, catch the specific error. `tests/contracts/test_boundaries.py` enforces this.
8. **Merge in gate order** (§8), using `git merge --no-ff` into `main`.

## 3. Sectors at a glance

| # | Sector | Branch and worktree | Delivers | Consumes | Can start |
| --- | --- | --- | --- | --- | --- |
| 0 | Foundation | `main` | Interfaces, config, fakes, contract tests, boundary checks | nothing | First |
| 1 | Engine | `engine` | Pure logic: merge and render the contract, ledger, redaction, verifier, patches, prompt composition | interfaces | After G0 |
| 2 | Models | `models` | Provider adapter, model chain, burst, extractor | interfaces | After G0 |
| 3 | Memory | `memory` | SQLite store, the Hindsight memory service | interfaces | After G0 |
| 4 | Orchestrator | `orchestrator` | Turn loop, the `BatonAPI` facade, wiring, scenario tests | interfaces, engine, fakes for Sectors 2 and 3 | After G0; real runs need G1 |
| 5 | Frontend | `frontend` | The Streamlit app | `BatonAPI` and view types only | After G0, on `FakeBaton` |
| 6 | Demo and docs | `demo` | `check_setup`, `measure_prefs`, `seed_demo`, demo script, README, ARCHITECTURE | `BatonAPI`, `ChatModel` | After G0; real runs need G4 |

Who provides what to whom:

```text
S0 interfaces    ──► every sector
S1 engine        ──► S4 orchestrator             pure functions, imported directly
S2 models        ──► S4 orchestrator, S6 demo    ChatModel, ModelChain, Extractor
S3 memory        ──► S4 orchestrator             Store, LongTermMemory
S4 orchestrator  ──► S5 frontend, S6 demo        BatonAPI
```

The engine, models, memory and frontend sectors never depend on each other, so all four can run at once after G0.

## 4. File ownership

| Sector | Owns |
| --- | --- |
| 0 Foundation | `baton/__init__.py`, `baton/config.py`, `baton/interfaces/**`, `tests/contracts/**`, `tests/conftest.py`, `pyproject.toml`, `requirements.txt`, `.env.example`, `.gitignore`, `scripts/check_ownership.py` |
| 1 Engine | `baton/engine/**`, `tests/engine/**` |
| 2 Models | `baton/llm/**`, `tests/llm/**`, `tests/live/test_models_live.py` |
| 3 Memory | `baton/memory/**`, `tests/memory/**`, `tests/live/test_memory_live.py` |
| 4 Orchestrator | `baton/orchestrator/**`, `tests/orchestrator/**`, `tests/scenario/**` |
| 5 Frontend | `app.py`, `baton/ui/**`, `.streamlit/**`, `tests/ui/**` |
| 6 Demo and docs | `scripts/**` (except `check_ownership.py`), `demo/**`, `docs/demo-script.md`, `README.md`, `ARCHITECTURE.md` |
| Shared: change only on `main` | `docs/superpowers/**`, `docs/research/**` |

**Conformance hookup.** The contract suites live in Sector 0's `tests/contracts/`. Each implementing sector adds `tests/<sector>/test_conformance.py`, which imports the suite and supplies a harness for its real implementation (§7). The suite stays in Sector 0's files, and the hookup stays in the owner's files.

**Dependencies.** Sector 0 declares every v1 dependency up front, with pinned versions: `streamlit`, `openai`, `pydantic>=2`, `hindsight-client`, `python-dotenv`, and `pytest` for development. `httpx` comes with `openai`. A sector that needs another package asks for a Sector 0 commit on `main`; it doesn't edit `requirements.txt` on its own branch.

## 5. The sector contracts

The code in this section is the contract. Sector 0 copies it into `baton/interfaces/`, adds docstrings, and writes the fakes and contract tests against it. All models are frozen Pydantic models with `extra="forbid"`. Every `datetime` is timezone-aware UTC.

### 5.1 Shared types: `baton/interfaces/types.py`

```python
CONTRACT_VERSION = "1.0"                       # baton/interfaces/version.py

class Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

class ItemKind(StrEnum):
    GOAL = "goal"; DECISION = "decision"; CONSTRAINT = "constraint"
    REJECTION = "rejection"; REVERSAL = "reversal"; PREFERENCE = "preference"
    NEXT_STEP = "next_step"; OPEN_QUESTION = "open_question"; RESOLVED = "resolved"
    RETRACTION = "retraction"; MODEL_BEHAVIOR = "model_behavior"; HANDOFF = "handoff"

class CheckId(StrEnum):
    REJECTED = "rejected"; CONTINUITY = "continuity"; NO_BULLETS = "no_bullets"
    MAX_WORDS = "max_words"; NO_EMOJIS = "no_emojis"; NO_PREAMBLE = "no_preamble"
    CODE_LANGUAGE = "code_language"

class ItemMeta(Frozen):
    session_id: str
    project: str
    user: str
    turn: int                                  # an edit outside a turn uses the last completed turn
    model: str | None                          # None for user edits
    source: Literal["extractor", "user_edit", "system"]
    created_at: datetime

class Item(Frozen):
    id: str                                    # uuid4 hex, from new_id()
    kind: ItemKind
    text: str
    reason: str | None = None
    aliases: tuple[str, ...] = ()
    check_id: CheckId | None = None
    params: dict[str, int | str | list[str]] = {}
    supersedes: str | None = None              # id of the item this one overrides
    meta: ItemMeta

class Preferences(Frozen):
    no_bullets: bool = False
    max_words: int | None = None               # None means off
    no_emojis: bool = False
    no_preamble: bool = False
    code_languages: tuple[str, ...] | None = None   # None means off
    free_text: tuple[str, ...] = ()            # stated in chat but not verifiable

class HandoffContract(Frozen):                 # the product's contract, as data
    project: str
    goal: Item | None = None
    next_step: Item | None = None
    decisions: tuple[Item, ...] = ()
    constraints: tuple[Item, ...] = ()
    rejections: tuple[Item, ...] = ()          # active only
    open_questions: tuple[Item, ...] = ()
    preferences: Preferences = Preferences()
    omitted: dict[str, int] = {}               # items left out by the caps, per kind

class LedgerEntry(Frozen):
    rejection: Item
    status: Literal["active", "reversed"]
    reversal: Item | None = None

class Message(Frozen):
    role: Literal["system", "user", "assistant"]
    content: str

class Completion(Frozen):
    text: str                                  # reasoning already stripped
    model_id: str
    prompt_tokens: int | None
    completion_tokens: int | None
    latency_ms: int

class CheckResult(Frozen):
    check_id: CheckId
    status: Literal["pass", "fail", "n/a"]
    evidence: str = ""
    level: int | None = None                   # patch level in force; None when memory is OFF

PatchLevels = dict[CheckId, int]               # 0 to 3

class PatchStat(Frozen):
    model_id: str
    check_id: CheckId
    level: int
    passes: int
    trials: int

class PatchSet(Frozen):
    system_rules: tuple[str, ...] = ()         # level 1 and up
    user_suffix: tuple[str, ...] = ()          # level 2 and up

class CheckContext(Frozen):
    prefs: Preferences
    active_rejections: tuple[Item, ...]
    first_reply_with_context: bool             # this model's first reply, and Baton holds items for the task
    next_step: str | None
    levels: PatchLevels = {}

class ExtractedItem(Frozen):                   # extractor output, before ids and metadata
    kind: Literal["goal", "decision", "constraint", "rejection", "reversal",
                  "preference", "next_step", "open_question", "resolved"]
    text: str
    reason: str | None
    aliases: list[str]
    check_id: CheckId | None
    max_words: int | None
    languages: list[str] | None
    target: str | None                         # for reversal and resolved: the approach or question it refers to

class ExtractResult(Frozen):
    items: tuple[ExtractedItem, ...] = ()
    extractor_model: str | None = None
    alerts: tuple["Alert", ...] = ()

class AlertCode(StrEnum):
    MEMORY_UPDATING = "memory_updating"; REPAIR_SKIPPED = "repair_skipped"
    EXTRACTION_FAILED = "extraction_failed"; REVERSAL_UNMATCHED = "reversal_unmatched"
    LTM_UNAVAILABLE = "ltm_unavailable"; LTM_NO_CREDITS = "ltm_no_credits"
    EMPTY_CONTRACT = "empty_contract"; MODEL_UNAVAILABLE = "model_unavailable"
    NO_MODEL = "no_model"

class Alert(Frozen):                           # the design spec's "warning"
    level: Literal["info", "amber", "red"]
    code: AlertCode
    message: str

class HandoffEvent(Frozen):
    from_model: str
    to_model: str | None                       # None when no model was available
    reason: Literal["429", "manual", "auth", "bad_request", "error"]
    retry_after: float | None
    memories_recalled: int
    at: datetime

class RecallTrace(Frozen):
    purpose: Literal["state", "ledger", "model", "team"]
    query: str
    tags: tuple[str, ...]
    result_count: int
    counts_by_type: dict[str, int]
    latency_ms: int
    error: str | None = None

class Observation(Frozen):
    text: str
    model_id: str | None = None

class L2Snapshot(Frozen):
    items: tuple[Item, ...] = ()
    observations: tuple[Observation, ...] = ()
    traces: tuple[RecallTrace, ...] = ()
    alerts: tuple[Alert, ...] = ()
    fetched_at: datetime

class WhyAnswer(Frozen):
    text: str | None
    sources: tuple[str, ...] = ()
    error: str | None = None

def new_id() -> str: ...                       # uuid4().hex
def utcnow() -> datetime: ...
def turn_document_id(session_id: str, turn: int) -> str: ...      # f"{session_id}:{turn}"
def edit_document_id(session_id: str, item_id: str) -> str: ...   # f"{session_id}:edit:{item_id}"

class Clock(Protocol):                         # injected so cooldowns can be tested
    def now(self) -> datetime: ...
```

Errors, in `baton/interfaces/errors.py`:

```python
class BatonError(Exception): ...

class RateLimited(BatonError):
    model_id: str
    retry_after: float                         # seconds, >= 0; the adapter fills in 60.0 if the provider gave none

class ModelUnavailable(BatonError):
    model_id: str
    reason: Literal["auth", "bad_request", "error"]
    detail: str
```

### 5.2 Engine: Sector 1 to Sector 4

These are pure functions, with no I/O, no clock reads and no randomness except `new_id()` in `resolve`. The orchestrator imports them directly from `baton.engine`. Their behaviour is specified in the design spec sections noted.

```python
# baton/engine/contract.py
def combine(l1: Sequence[Item], l2: Sequence[Item], *, session_id: str,
            project: str, prefs: Preferences) -> HandoffContract
    # Drops L2 items from session_id, de-duplicates, applies supersession, the merge rules (§7.1) and the caps (§7.3)
def ledger(items: Sequence[Item]) -> list[LedgerEntry]
def render(contract: HandoffContract) -> str               # the §7.3 block; no list markers
def resolve(extracted: Sequence[ExtractedItem], existing: Sequence[Item],
            contract: HandoffContract, meta: ItemMeta) -> tuple[list[Item], list[Alert]]
    # New ids and metadata; alias cleaning (§7.2); matches reversal and resolved targets
def preferences_from(items: Sequence[Item], base: Preferences) -> Preferences

# baton/engine/redact.py
def redact(text: str) -> tuple[str, dict[str, int]]         # redacted text, match counts by type (§13)
def redact_item(item: Item) -> Item

# baton/engine/verifier.py
def verify(reply: str, ctx: CheckContext) -> list[CheckResult]   # §10.1; includes n/a results

# baton/engine/patches.py
def choose_levels(stats: Sequence[PatchStat], checks: Sequence[CheckId]) -> PatchLevels   # §10.3
def escalate(levels: PatchLevels, failed: Sequence[CheckId]) -> PatchLevels             # +1, capped at 3
def patch_set(levels: PatchLevels, ctx: CheckContext) -> PatchSet                       # §10.2

# baton/engine/compose.py
def compose(*, memory_on: bool, contract_block: str | None, patches: PatchSet | None,
            history: Sequence[Message], user_msg: str) -> list[Message]                 # §8.3
def strip_reasoning(text: str) -> str
```

**Guarantee:** calling any of these twice with the same input gives the same output, `resolve`'s ids aside.

### 5.3 Models: Sector 2 to Sectors 4 and 6

```python
class ModelProfile(Frozen):
    id: str                                    # "groq:openai/gpt-oss-120b"
    label: str                                 # "gpt-oss-120b · Groq"
    provider: Literal["groq", "gemini", "ollama"]
    model: str                                 # the provider's own model name
    base_url: str
    api_key_env: str | None
    extra: dict[str, str] = {}                 # e.g. {"reasoning_effort": "none"}
    max_tokens: int = 1024
    strict_json: bool
    burstable: bool                            # Groq models only

class ChatModel(Protocol):
    @property
    def profile(self) -> ModelProfile: ...
    def complete(self, messages: Sequence[Message], *, max_tokens: int | None = None,
                 json_schema: dict | None = None) -> Completion: ...
    # Raises only RateLimited or ModelUnavailable. Never retries.

class ModelState(StrEnum):
    READY = "ready"; COOLING = "cooling"; BENCHED = "benched"; DISABLED = "disabled"

class ModelStatus(Frozen):
    model_id: str
    label: str
    provider: str
    state: ModelState
    cooldown_until: datetime | None
    is_active: bool
    burstable: bool
    detail: str | None = None

class BurstResult(Frozen):
    model_id: str
    requests: int
    tokens_sent: int
    got_429: bool
    retry_after: float | None

class ModelChain(Protocol):
    def models(self) -> list[ChatModel]: ...
    def candidates(self, session_id: str) -> list[ChatModel]: ...
        # Active model first, then the rest in chain order, wrapping around; skips non-ready models
    def active(self, session_id: str) -> str | None: ...
    def set_active(self, session_id: str, model_id: str) -> None: ...   # sticky until it fails or the user switches
    def bench(self, session_id: str, model_id: str) -> None: ...        # manual switch; per session
    def cool_down(self, model_id: str, seconds: float) -> None: ...     # global, for all sessions
    def disable(self, model_id: str, detail: str) -> None: ...          # global
    def status(self, session_id: str) -> list[ModelStatus]: ...
    def burst(self, model_id: str) -> BurstResult: ...                  # ValueError if not burstable

class Extractor(Protocol):
    def extract(self, *, user_msg: str, reply: str,
                contract: HandoffContract) -> ExtractResult: ...
    # Never raises. On failure: items=() and an EXTRACTION_FAILED alert.
```

**Guarantees:**
- `complete` maps every provider or SDK error to one of the two errors above. A 429 without a usable delay becomes `RateLimited(retry_after=60.0)`.
- The model chain is thread-safe and reads time only through the injected `Clock`.

### 5.4 Memory: Sector 3 to Sector 4

```python
class SessionRecord(Frozen):
    id: str
    project: str
    user: str
    memory_on: bool
    prefs: Preferences
    created_at: datetime

class MessageRecord(Frozen):
    id: int | None = None                      # set by the store
    session_id: str
    turn: int
    role: Literal["user", "assistant"]
    model: str | None
    attempt: Literal["user", "first", "repair", "rerun"]
    memory_on: bool
    is_final: bool
    patch_levels: PatchLevels = {}
    content: str                               # already redacted
    created_at: datetime

class LearningPoint(Frozen):
    model_id: str
    session_id: str
    session_started_at: datetime
    first_attempt_checks: int
    first_attempt_failures: int

class Store(Protocol):
    # Sessions
    def create_session(self, project: str, user: str, memory_on: bool) -> SessionRecord: ...
    def get_session(self, session_id: str) -> SessionRecord: ...          # KeyError if unknown
    def update_session(self, session_id: str, *, memory_on: bool | None = None,
                       prefs: Preferences | None = None) -> SessionRecord: ...
    def list_projects(self) -> list[str]: ...
    # Messages and checks
    def next_turn(self, session_id: str) -> int: ...
    def save_message(self, msg: MessageRecord) -> int: ...
    def set_final(self, session_id: str, turn: int, message_id: int) -> None: ...
    def messages(self, session_id: str) -> list[MessageRecord]: ...
    def save_verifications(self, message_id: int, results: Sequence[CheckResult]) -> None: ...
    def verifications(self, message_id: int) -> list[CheckResult]: ...
    # L1 items and the retain outbox
    def add_items(self, items: Sequence[Item]) -> None: ...
    def replace_turn_items(self, session_id: str, turn: int, items: Sequence[Item]) -> None: ...
    def items(self, session_id: str) -> list[Item]: ...
    def unretained(self) -> list[tuple[str, str, int]]: ...              # (project, session_id, turn)
    def mark_retained(self, session_id: str, turn: int) -> None: ...
    # Learning
    def patch_stats(self, model_id: str) -> list[PatchStat]: ...
    def record_trial(self, model_id: str, check_id: CheckId, level: int, passed: bool) -> None: ...
    def learning_points(self) -> list[LearningPoint]: ...
    # Handoffs and recalls
    def log_handoff(self, session_id: str, turn: int, event: HandoffEvent) -> None: ...
    def handoffs(self, session_id: str) -> list[tuple[int, HandoffEvent]]: ...
    def save_recall(self, session_id: str, turn: int, trace: RecallTrace) -> None: ...
    def recalls(self, session_id: str) -> list[RecallTrace]: ...          # from the latest recall only

class LongTermMemory(Protocol):
    def ensure_bank(self, project: str) -> list[Alert]: ...
    def retain(self, project: str, document_id: str, items: Sequence[Item],
               on_done: Callable[[bool], None] | None = None) -> None: ...
        # Returns immediately. Replaces the whole document. on_done(True) once Hindsight accepts it.
    def snapshot(self, project: str, *, model_id: str, timeout: float = 5.0) -> L2Snapshot: ...
        # The three recalls in §12.3, run in parallel. Never raises.
    def team(self, project: str, *, timeout: float = 5.0) -> L2Snapshot: ...
    def why(self, project: str, approach: str, *, timeout: float = 20.0) -> WhyAnswer: ...
    def observations(self, project: str, model_id: str, *,
                     timeout: float = 5.0) -> tuple[list[Observation], list[Alert]]: ...
```

**Guarantees:**
- The store is thread-safe, with one SQLite connection per thread in WAL mode.
- `LongTermMemory` never raises. A timeout comes back as an `LTM_UNAVAILABLE` alert and a 402 as `LTM_NO_CREDITS`.
- `LongTermMemory` rebuilds each `Item` from Hindsight metadata, never from the recalled text (design spec §12.2).
- Neither the store nor long-term memory redacts. The orchestrator redacts every item and message before handing it over, and a `BatonAPI` contract test proves it.

### 5.5 `BatonAPI`: Sector 4 to Sectors 5 and 6 (the frontend's contract)

The UI talks only to this facade. It never reads SQLite, Hindsight or a model directly.

```python
class SessionView(Frozen):
    session_id: str
    project: str
    user: str
    memory_on: bool
    prefs: Preferences
    turns: int
    created_at: datetime

class ChipView(Frozen):                        # CheckResult without n/a, ready to render
    check_id: CheckId
    passed: bool
    label: str                                 # e.g. "no-bullets", "rejected: Redis"
    evidence: str

class ReplyView(Frozen):
    message_id: int
    model_id: str
    model_label: str
    text: str
    memory_on: bool
    attempt: Literal["first", "repair", "rerun"]
    chips: tuple[ChipView, ...]

class TurnView(Frozen):
    session_id: str
    turn: int
    user_text: str
    reply: ReplyView | None                    # None when no model was available
    earlier_attempts: tuple[ReplyView, ...] = ()   # shown collapsed: a repaired first attempt, a replaced re-run
    handoffs: tuple[HandoffEvent, ...] = ()
    alerts: tuple[Alert, ...] = ()
    fallback_contract: str | None = None       # the copyable contract when no model answered
    can_rerun: bool = False                    # the last turn only
    rerun_memory_on: bool | None = None        # the memory setting a re-run would use

class ContractView(Frozen):
    contract: HandoffContract
    rendered: str                              # redacted; the Copy baton text
    alerts: tuple[Alert, ...] = ()

class LedgerRow(Frozen):
    item_id: str
    approach: str
    reason: str | None
    aliases: tuple[str, ...]
    turn: int
    model: str | None
    user: str
    status: Literal["active", "reversed"]
    reversal_reason: str | None = None

class TraceView(Frozen):
    traces: tuple[RecallTrace, ...]
    l1_items: tuple[Item, ...]
    l2_items: tuple[Item, ...]
    observations: tuple[Observation, ...]
    fetched_at: datetime | None
    alerts: tuple[Alert, ...] = ()

class LearningSeries(Frozen):
    model_id: str
    label: str
    points: tuple[tuple[int, float], ...]      # (session index, first-attempt violation rate)

class LearningView(Frozen):
    series: tuple[LearningSeries, ...]
    stats: tuple[PatchStat, ...]
    observations: dict[str, tuple[Observation, ...]]   # keyed by model_id
    alerts: tuple[Alert, ...] = ()

class TeamMember(Frozen):
    user: str
    decisions: tuple[Item, ...]
    rejections: tuple[Item, ...]
    reversals: tuple[Item, ...]

class TeamView(Frozen):
    members: tuple[TeamMember, ...]
    fetched_at: datetime | None
    alerts: tuple[Alert, ...] = ()

class WhyView(Frozen):
    item_id: str
    answer: WhyAnswer

class BurstView(Frozen):
    result: BurstResult
    alerts: tuple[Alert, ...] = ()

class BatonAPI(Protocol):
    # Sessions
    def start_session(self, *, project: str, user: str, memory_on: bool = True) -> SessionView: ...
    def session(self, session_id: str) -> SessionView: ...
    def list_projects(self) -> list[str]: ...
    # Commands
    def send(self, session_id: str, text: str) -> TurnView: ...
    def rerun_last_turn(self, session_id: str) -> TurnView: ...
    def set_memory(self, session_id: str, on: bool) -> SessionView: ...
    def set_preferences(self, session_id: str, prefs: Preferences) -> SessionView: ...
    def switch_model(self, session_id: str) -> list[ModelStatus]: ...
    def use_model(self, session_id: str, model_id: str) -> list[ModelStatus]: ...
    def burst(self, model_id: str) -> BurstView: ...
    def refresh_memory(self, session_id: str) -> TraceView: ...
    def add_item(self, session_id: str, kind: ItemKind, text: str) -> ContractView: ...
    def edit_item(self, session_id: str, item_id: str, text: str) -> ContractView: ...
    def delete_item(self, session_id: str, item_id: str) -> ContractView: ...
    def reverse_rejection(self, session_id: str, item_id: str, reason: str | None = None) -> list[LedgerRow]: ...
    def set_aliases(self, session_id: str, item_id: str, aliases: Sequence[str]) -> list[LedgerRow]: ...
    def ask_why(self, session_id: str, item_id: str) -> WhyView: ...
    # Queries
    def transcript(self, session_id: str) -> list[TurnView]: ...
    def chain_status(self, session_id: str) -> list[ModelStatus]: ...
    def contract(self, session_id: str) -> ContractView: ...
    def ledger(self, session_id: str) -> list[LedgerRow]: ...
    def trace(self, session_id: str) -> TraceView: ...
    def learning(self) -> LearningView: ...
    def team(self, session_id: str) -> TeamView: ...
    def pending_jobs(self, session_id: str) -> int: ...     # background jobs still running
```

**Guarantees:**
- **Thread safety:** the implementation is thread-safe. The UI creates one instance per process with `st.cache_resource`.
- **Blocking:** `send` and `rerun_last_turn` return once the reply is final, after at most one repair. Extraction and retain carry on in the background, and `pending_jobs` counts them.
- **Errors:** for expected failures, the methods never raise. Model, memory and extraction failures come back as `Alert`s inside the views. They raise only `KeyError` (an unknown session or item) and `ValueError` (invalid arguments, e.g. `burst` on a model that isn't burstable), both of which mean a bug in the caller.
- **Views** are frozen Pydantic models made only of plain data. They're safe to cache and compare between Streamlit reruns.
- **Wiring:** `baton.orchestrator.wiring.build_baton(settings, *, chain=None, extractor=None, store=None, memory=None) -> BatonAPI` builds the real graph. Any argument you pass replaces that real component, which is how G5 and the scenario tests plug in fakes. `BATON_BACKEND=fake` returns `FakeBaton` instead. `app.py` calls only this.

### 5.6 Where each error goes

| Boundary | May raise | Reports other failures as |
| --- | --- | --- |
| `ChatModel.complete` | `RateLimited`, `ModelUnavailable` | nothing else |
| `ModelChain` | `ValueError` from `burst` on a model that can't burst | `ModelStatus.state` and `detail` |
| `Extractor.extract` | nothing | `ExtractResult.alerts` |
| `Store` | `KeyError`; `sqlite3` errors propagate, because they are bugs | nothing else |
| `LongTermMemory` | nothing | `alerts` on the snapshot, `WhyAnswer.error`, `on_done(False)` |
| `BatonAPI` | `KeyError`, `ValueError` | `alerts` on every view |

## 6. Fakes: `baton/interfaces/fakes/`

| Fake | Behaviour |
| --- | --- |
| `FakeChatModel(profile, script)` | Returns the scripted replies in order. A script entry can be an exception, e.g. `RateLimited(...)`. Records the messages it received, for assertions. |
| `FakeModelChain(models, clock)` | The cooldown, bench and sticky rules held in memory. `burst` reports a 429 on its first request. |
| `FakeExtractor(rules)` | Deterministic keyword rules, e.g. "no redis" becomes a rejection of Redis. It can be told to fail. |
| `FakeStore()` | In-memory dictionaries implementing all of `Store`. |
| `FakeLongTermMemory(clock)` | In-memory documents with tag filtering. It can be told to time out, run out of credits, or delay indexing. |
| `FakeBaton()` | A complete `BatonAPI` with no network. It plays the six-act demo deterministically: a 429 on burst; Redis re-suggested when memory is OFF; a repair on the first bullet-list reply; team items; an answer to "Why?". `FakeBaton.kitchen_sink()` returns one `TurnView` for every UI state (§9). |

Every fake passes the same contract suite as its real counterpart.

## 7. Contract tests: `tests/contracts/`

Each suite is written against a small **harness**: a factory the suite calls to get an implementation in a given situation. Sector 0 provides the harness for the fake; the owning sector provides the harness for the real implementation in its `test_conformance.py`.

| Suite | Harness gives the suite | What it asserts |
| --- | --- | --- |
| `test_chat_model.py` | A model that will answer, return a 429 (with and without `retry-after`), a 401, a 500 or a timeout. The real harness uses `httpx.MockTransport`. | The right `Completion` or error; `retry_after` rules; exactly one HTTP request per call, so no retries |
| `test_model_chain.py` | A chain of 3 models and a controllable clock | Candidate order; stickiness; cooldown expiry; bench is per session; status states |
| `test_extractor.py` | An extractor with valid, invalid and failing model output | Never raises; valid output parsed; one retry on invalid output; an `EXTRACTION_FAILED` alert |
| `test_store.py` | A fresh store | Round trips of every record; turn numbering; `set_final`; the outbox; patch stats adding up |
| `test_long_term_memory.py` | Memory that's healthy, times out, has no credits, or delays indexing. The real harness uses a fake Hindsight client object. | Retained items come back from `snapshot` with metadata intact; replacing a document; tag filtering; never raises; the right alerts |
| `test_baton_api.py` | A `BatonAPI` over fake models and memory | Every §5.5 guarantee; the handoff on burst; memory OFF behaviour; a re-run flips memory; a secret typed into chat never reaches the store or long-term memory; `KeyError` for an unknown session |
| `test_boundaries.py` | nothing | Import rules (§2, rule 2) by scanning the syntax tree of every module; no broad `except` outside the two allowed files |

## 8. Integration gates and merge order

| Gate | Merges | Passes when |
| --- | --- | --- |
| G0 | Sector 0, foundation | Every contract suite passes against every fake; boundary tests pass |
| G1 | Sector 1, engine | Engine unit tests pass |
| G2 | Sector 2, models | Conformance suites pass for `ChatModel`, `ModelChain` and `Extractor`; the live model tests have passed once by hand |
| G3 | Sector 3, memory | Conformance suites pass for `Store` (real SQLite) and `LongTermMemory`; the live Hindsight round trip has passed once by hand |
| G4 | Sector 4, orchestrator | `BatonAPI` conformance passes for the real facade; the six-act scenario tests pass with the real engine and store and fake models and memory |
| G5 | Sector 5, frontend | Streamlit `AppTest` smoke tests pass on `FakeBaton`, then again on the real facade wired to fake models |
| G6 | Live integration; owners fix only | `check_setup` passes; `pytest -m live` passes; the six acts run by hand against the real services |
| G7 | Sector 6, demo and docs | `measure_prefs` and `seed_demo` run; the README steps reproduce the demo from a fresh clone |

**Order:** G0, then G1, G2, G3 and frontend development in parallel, then G4, then G5, G6 and G7. G1 to G3 can merge in any order.

- **The frontend can merge before G4.** `app.py` defaults to `BATON_BACKEND=fake` until G5 switches the default to `real`.
- **After every merge,** each open branch rebases on `main` and runs the full suite.
- **Who fixes what:** a test that fails after a rebase belongs to the branch owner. The exception is a failing contract test, which goes back to whoever owns that contract.

**Definition of done for any sector:**
- Its own tests and its conformance tests pass, and so does the full suite after rebasing on `main`.
- `check_ownership.py` passes, and so do the boundary tests.
- There are no TODOs left, and every public function has a docstring.

## 9. Brief for the frontend sector

**Goal:** build the design spec §15 UI against `BatonAPI` and the view types.

**Imports:**
- `app.py` may import `baton.orchestrator.wiring.build_baton` and `baton.config`.
- `baton/ui/**` may import only `baton.interfaces` and Streamlit.

**Backend:** develop and test on `BATON_BACKEND=fake`. No API keys are needed until G5.

**Streamlit rules:**
- Create the `BatonAPI` with `@st.cache_resource`.
- Keep only `session_id`, `turn_in_flight` and keys prefixed `ui.` in `st.session_state`.
- Refresh the right-hand panel in `st.fragment(run_every=2)`.
- Guard double submits with `turn_in_flight`.
- Never call `BatonAPI` from a background thread.

**States that must render**, all covered by `FakeBaton.kitchen_sink()`:
- **Chips:** pass and fail for every check.
- **Reply variants:** a repaired reply with its first attempt collapsed; a re-run reply with the replaced one collapsed.
- **Handoffs and memory:** a handoff banner for each reason; the memory-OFF border and banner.
- **Failures:** the no-model fallback with the copyable contract; an alert at each level.
- **Models:** a model cooling down with a countdown; a benched model; a disabled model.
- **Empty states:** no observations, an empty ledger, an empty team.

**Tests:** `AppTest` smoke tests for each tab and each kitchen-sink state, plus an import-boundary test.

**Start:** the `frontend` worktree was branched before G0, so it contains only docs. Rebase onto `main` once G0 lands, and write no product code before then.

## 10. Changes to the design spec

These are applied to `2026-09-29-baton-design.md` in the same commit as this document:

- **Layout:** the package is organised by sector (`interfaces/`, `engine/`, `llm/`, `memory/`, `orchestrator/`, `ui/`), and §6 is updated to match.
- **UI access:** the UI talks only to `BatonAPI` and never reads the store.
- **The L1/L2 merge** is the engine function `combine`, so the memory sector only does I/O (§12.4).
- **The retain outbox retry** moves from the memory service to the orchestrator, so `LongTermMemory` doesn't need the store (§12.5).
- **Naming:** the typed `Warning` is renamed `Alert`, so it doesn't shadow Python's built-in `Warning`.
- **Backend switch:** `BATON_BACKEND=fake|real` chooses the backend.
