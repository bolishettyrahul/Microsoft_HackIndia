# Baton: sectors and handoff contracts

- **Date:** 2026-09-29
- **Status:** Draft for review
- **Builds on:** `2026-09-29-baton-design.md` (the design spec)

## 1. Why this document exists

Baton v1 is built in three sectors: **AI**, **backend** and **frontend**. They are built in parallel, one git worktree each. Two things keep integration clean:

- **Each sector owns its own files,** so no two branches ever edit the same file.
- **Each boundary has exactly one handoff contract,** written as code before any sector starts, with a fake and a test suite. The frontend calls the backend only through `BatonAPI`, and the backend calls the AI sector only through `AIServices`.

**Two meanings of "handoff contract".** Baton's product feature is also called a handoff contract: the `HandoffContract` block of goal, decisions and rejections. This document means the agreement at a sector boundary. The code for these agreements lives in `baton/interfaces/`.

## 2. The three sectors

```text
Frontend ──BatonAPI──► Backend ──AIServices──► AI ──► Groq, Gemini, Ollama, Hindsight, SQLite
```

| Sector | Worktree and branch | What it builds | Hands off through |
| --- | --- | --- | --- |
| **AI** | `.claude/worktrees/ai`, `worktree-ai` | **Model calls** to Groq, Gemini and Ollama: the model chain and cooldowns, the burst, the extractor. **Memory management** with the two-tier cache: the SQLite L1 working memory and records, Hindsight L2, and the event-loop thread that owns the Hindsight client. | `AIServices`, to the backend |
| **Backend** | `.claude/worktrees/backend`, `worktree-backend` | **The engine:** contract merge and rendering, the ledger, the verifier and patch ladder, prompt building, redaction. **The orchestrator:** the turn loop, handoffs, repair, re-runs, the retain outbox, and the `BatonAPI` facade. Plus the demo scripts that drive it. | `BatonAPI`, to the frontend |
| **Frontend** | `.claude/worktrees/frontend`, `worktree-frontend` | The Streamlit UI: the sidebar, the chat and the five tabs. Every user action calls exactly one `BatonAPI` method, and every screen renders a `BatonAPI` view. | none; it only consumes |

**Contracts come first.** Before the sectors split, the contracts are built on `main` (§5): the shared types, both handoff contracts, the fakes and the contract tests. Then all three sectors start at the same time:
- the AI sector builds against the contract suites;
- the backend builds against a fake AI (`FakeAIServices`);
- the frontend builds against a fake backend (`FakeBaton`).

## 3. Rules

1. **Contracts land on `main` first.** Nothing else starts before gate G0.
2. **Talk only through the contract:**
   - The frontend imports only `baton.interfaces`. `app.py` may also import `build_baton` from the backend's wiring.
   - The backend reaches the AI sector only through `AIServices`. `baton/backend/wiring.py` is the one backend file allowed to import `baton.ai`, and only to call `build_ai`.
   - The AI sector imports only `baton.interfaces`.

   `tests/contracts/test_boundaries.py` scans every import and fails on anything else.
3. **Edit only your own files** (§4). `scripts/check_ownership.py <sector>` fails if a branch touches another sector's files. It runs before every merge.
4. **Build against fakes.** Until integration, the backend's tests use `FakeAIServices`, and the frontend runs on `FakeBaton`.
5. **Contract tests decide.** `tests/contracts/` has one suite per protocol. Each suite runs against the fake on `main` and against the real implementation in the owning sector. A sector merges only when its real implementation passes.
6. **Contracts change only on `main`.** A change is one commit that updates the protocol, the fake, the contract tests and `CONTRACT_VERSION` together. Every open branch rebases that same day.
   - An additive change (a new optional field or a new method) bumps the minor version.
   - Anything else bumps the major version and needs the agreement of the sector on the other side of the boundary.
7. **No broad `except`.** `except Exception` and a bare `except:` are allowed only in `baton/ai/provider.py` and `baton/ai/hindsight.py`, where provider and Hindsight errors are turned into contract errors and alerts. `test_boundaries.py` enforces this.
8. **Merge in gate order** (§8), using `git merge --no-ff` into `main`.

## 4. Files

### Ownership

| Owner | Files |
| --- | --- |
| Contracts (on `main`) | `baton/__init__.py`, `baton/config.py`, `baton/interfaces/**`, `tests/contracts/**`, `tests/conftest.py`, `pyproject.toml`, `requirements.txt`, `.env.example`, `.gitignore`, `scripts/check_ownership.py` |
| AI | `baton/ai/**`, `tests/ai/**`, `tests/live/**`, `scripts/check_setup.py` |
| Backend | `baton/backend/**`, `tests/backend/**`, `tests/scenario/**`, `scripts/measure_prefs.py`, `scripts/seed_demo.py`, `scripts/seed_sessions.json`, `demo/**` |
| Frontend | `app.py`, `baton/ui/**`, `.streamlit/**`, `tests/ui/**` |
| Shared: change on `main` only | `docs/**`, `README.md`, `ARCHITECTURE.md` |

### Package layout

```text
baton/
  config.py              settings from .env; limits                              Contracts
  interfaces/            types, both contracts, errors, views, fakes              Contracts
  ai/                                                                             AI
    profiles.py          the model profiles (design spec §9.1)
    provider.py          OpenAICompatModel: one class for Groq, Gemini and Ollama
    chain.py             ModelChain: active model, cooldowns, status, burst
    extractor.py         Extractor; strict_schema()
    store.py             SQLite Store: L1 working memory, messages, checks, stats
    hindsight.py         the Hindsight event-loop thread and LongTermMemory (L2)
    build.py             build_ai(settings) -> AIServices
  backend/                                                                        Backend
    contract.py          combine(), ledger(), render(), resolve()
    redact.py            redact(), redact_item()
    verifier.py          verify()
    patches.py           choose_levels(), escalate(), patch_set()
    compose.py           compose(), strip_reasoning()
    turn.py              run_turn(), rerun_last_turn(), the retain outbox
    facade.py            Baton: the BatonAPI implementation and its view builders
    wiring.py            build_baton(settings, ai=None) -> BatonAPI
  ui/                                                                             Frontend
    sidebar.py  chat.py  tab_baton.py  tab_ledger.py  tab_trace.py
    tab_learning.py  tab_team.py
app.py                   Streamlit entry point                                    Frontend
```

### Conformance hookup and dependencies

The contract suites live in `tests/contracts/`. Each implementing sector adds `tests/<sector>/test_conformance.py`, which imports the suites and supplies a harness for its real implementation (§7).

The contracts commit declares every v1 dependency up front, with pinned versions: `streamlit`, `openai`, `pydantic>=2`, `hindsight-client`, `python-dotenv`, and `pytest` for development. `httpx` comes with `openai`. A sector that needs another package asks for a commit on `main`; it doesn't edit `requirements.txt` on its own branch.

## 5. The handoff contracts

The code in this section is the contract. It goes into `baton/interfaces/` with docstrings, and the fakes and contract tests are written against it. All models are frozen Pydantic models with `extra="forbid"`. Every `datetime` is timezone-aware UTC.

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

class Alert(Frozen):
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
    retry_after: float                         # seconds, >= 0; 60.0 when the provider gave none

class ModelUnavailable(BatonError):
    model_id: str
    reason: Literal["auth", "bad_request", "error"]
    detail: str
```

### 5.2 AI to backend: `AIServices`

The AI sector hands the backend one bundle, built by one function:

```python
@dataclass(frozen=True)
class AIServices:
    chain: ModelChain                          # models and cooldowns
    extractor: Extractor
    store: Store                               # L1 working memory and records (SQLite)
    memory: LongTermMemory                     # L2 (Hindsight)

# baton/ai/build.py, the only AI function the backend calls
def build_ai(settings: Settings) -> AIServices: ...
```

**Models:**

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

**Memory and cache:**

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

class Store(Protocol):                         # L1, the fast tier
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

class LongTermMemory(Protocol):                # L2, Hindsight
    def ensure_bank(self, project: str) -> list[Alert]: ...
    def retain(self, project: str, document_id: str, items: Sequence[Item],
               on_done: Callable[[bool], None] | None = None) -> None: ...
        # Returns immediately. Replaces the whole document. on_done(True) once Hindsight accepts it.
    def snapshot(self, project: str, *, model_id: str, timeout: float = 5.0) -> L2Snapshot: ...
        # The three recalls in design spec §12.3, run in parallel. Never raises.
    def team(self, project: str, *, timeout: float = 5.0) -> L2Snapshot: ...
    def why(self, project: str, approach: str, *, timeout: float = 20.0) -> WhyAnswer: ...
    def observations(self, project: str, model_id: str, *,
                     timeout: float = 5.0) -> tuple[list[Observation], list[Alert]]: ...
```

**Guarantees from the AI sector:**
- **Errors:** `complete` turns every provider or SDK error into `RateLimited` or `ModelUnavailable`. A 429 with no usable delay becomes `RateLimited(retry_after=60.0)`.
- **Thread safety:**
  - The chain is thread-safe, and it reads the time only through the injected `Clock`.
  - The store is thread-safe, with one SQLite connection per thread in WAL mode.
- **`LongTermMemory` never raises.** A timeout comes back as an `LTM_UNAVAILABLE` alert and a 402 as `LTM_NO_CREDITS`. It rebuilds each `Item` from Hindsight metadata, never from the recalled text (design spec §12.2).
- **No redaction here:** the AI sector doesn't redact. The backend redacts every item and message before handing it over, and a `BatonAPI` contract test proves it.

### 5.3 Backend to frontend: `BatonAPI`

The frontend talks only to this facade. Each user action in the design spec's §15 UI maps to exactly one method, and each screen renders one view.

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

# baton/backend/wiring.py, the only backend function the frontend calls
def build_baton(settings: Settings, *, ai: AIServices | None = None) -> BatonAPI: ...
    # ai=None calls build_ai(settings). Passing FakeAIServices() runs the real backend on fake AI.
    # BATON_BACKEND=fake returns FakeBaton instead.
```

**Every UI action and the call it makes:**

| UI control (design spec §15) | `BatonAPI` call | Renders |
| --- | --- | --- |
| App load, "New session", project picker, user name | `start_session`, `list_projects` | `SessionView` |
| Chat input | `send` | `TurnView` |
| "Re-run with memory ON/OFF" | `rerun_last_turn` | `TurnView` |
| Memory toggle | `set_memory` | `SessionView` |
| Preference checkboxes | `set_preferences` | `SessionView` |
| "Switch model now" | `switch_model` | `list[ModelStatus]` |
| "Use" on a model | `use_model` | `list[ModelStatus]` |
| "Exhaust rate limit" | `burst` | `BurstView` |
| "Refresh memory" | `refresh_memory` | `TraceView` |
| Baton tab edits | `add_item`, `edit_item`, `delete_item` | `ContractView` |
| Copy baton | `contract` | `ContractView.rendered` |
| Ledger "Reverse", alias edit | `reverse_rejection`, `set_aliases` | `list[LedgerRow]` |
| Ledger "Why?" | `ask_why` | `WhyView` |
| Chat history on rerun | `transcript` | `list[TurnView]` |
| Sidebar model lights | `chain_status` | `list[ModelStatus]` |
| Memory trace, Model learning and Team tabs | `trace`, `learning`, `team` | `TraceView`, `LearningView`, `TeamView` |
| Right-panel auto-refresh | `pending_jobs` | `int` |

**Guarantees from the backend:**
- **Thread safety:** the implementation is thread-safe. The UI creates one instance per process with `st.cache_resource`.
- **Blocking:** `send` and `rerun_last_turn` return once the reply is final, after at most one repair. Extraction and retain carry on in the background, and `pending_jobs` counts them.
- **Errors:** for expected failures, the methods never raise. Model, memory and extraction failures come back as `Alert`s inside the views. They raise only `KeyError` (an unknown session or item) and `ValueError` (invalid arguments), both of which mean a bug in the caller.
- **Views** are frozen Pydantic models made only of plain data. They're safe to cache and to compare between Streamlit reruns.

### 5.4 Where each error goes

| Boundary | May raise | Reports other failures as |
| --- | --- | --- |
| `ChatModel.complete` | `RateLimited`, `ModelUnavailable` | nothing else |
| `ModelChain` | `ValueError` from `burst` on a model that can't burst | `ModelStatus.state` and `detail` |
| `Extractor.extract` | nothing | `ExtractResult.alerts` |
| `Store` | `KeyError`; `sqlite3` errors propagate, because they are bugs | nothing else |
| `LongTermMemory` | nothing | `alerts` on the snapshot, `WhyAnswer.error`, `on_done(False)` |
| `BatonAPI` | `KeyError`, `ValueError` | `alerts` on every view |

### 5.5 Backend internals (not a contract)

The engine is the backend's own business, and the backend can change it freely. For reference, the design spec assigns these pure functions: `combine`, `ledger`, `render` and `resolve` (§7, §12.4); `redact` (§13); `verify` (§10.1); `choose_levels`, `escalate` and `patch_set` (§10.2 to §10.3); `compose` and `strip_reasoning` (§8.3).

## 6. Fakes: `baton/interfaces/fakes/`

| Fake | Stands in for | Behaviour |
| --- | --- | --- |
| `FakeAIServices()` | the whole AI sector | Bundles the four fakes below. The backend builds and tests against it until integration. |
| `FakeChatModel(profile, script)` | one model | Returns the scripted replies in order; an entry can be an exception such as `RateLimited(...)`. Records the messages it received. |
| `FakeModelChain(models, clock)` | the chain | The cooldown, bench and sticky rules held in memory. `burst` reports a 429 on its first request. |
| `FakeExtractor(rules)` | the extractor | Deterministic keyword rules, e.g. "no redis" becomes a rejection of Redis. It can be told to fail. |
| `FakeStore()` | L1 | In-memory dictionaries implementing all of `Store`. |
| `FakeLongTermMemory(clock)` | L2 | In-memory documents with tag filtering. It can be told to time out, run out of credits, or delay indexing. |
| `FakeBaton()` | the whole backend | A complete `BatonAPI` with no network. It plays the six-act demo deterministically: a 429 on burst; Redis re-suggested when memory is OFF; a repair on the first bullet-list reply; team items; an answer to "Why?". `FakeBaton.kitchen_sink()` returns one `TurnView` for every UI state (§9). |

Every fake passes the same contract suite as the real thing.

## 7. Contract tests: `tests/contracts/`

Each suite is written against a small **harness**: a factory the suite calls to get an implementation in a given situation. `main` provides the harness for the fake; the owning sector provides the harness for the real implementation in its `test_conformance.py`.

| Suite | Implemented by | Harness gives the suite | What it asserts |
| --- | --- | --- | --- |
| `test_chat_model.py` | AI | A model that will answer, return a 429 (with and without `retry-after`), a 401, a 500 or a timeout. The real harness uses `httpx.MockTransport`. | The right `Completion` or error; the `retry_after` rules; exactly one HTTP request per call, so no retries |
| `test_model_chain.py` | AI | A chain of 3 models and a controllable clock | Candidate order; stickiness; cooldown expiry; bench is per session; status states |
| `test_extractor.py` | AI | An extractor with valid, invalid and failing model output | Never raises; valid output parsed; one retry on invalid output; an `EXTRACTION_FAILED` alert |
| `test_store.py` | AI | A fresh store | Round trips of every record; turn numbering; `set_final`; the outbox; patch stats adding up |
| `test_long_term_memory.py` | AI | Memory that's healthy, times out, has no credits, or delays indexing. The real harness uses a fake Hindsight client object. | Retained items come back from `snapshot` with metadata intact; replacing a document; tag filtering; never raises; the right alerts |
| `test_baton_api.py` | Backend | A `BatonAPI` built with `build_baton(settings, ai=FakeAIServices())` | Every §5.3 guarantee; the handoff on burst; memory OFF behaviour; a re-run flips memory; a secret typed into chat never reaches the store or long-term memory; `KeyError` for an unknown session |
| `test_boundaries.py` | everyone | nothing | The import rules (§3, rule 2), by scanning the syntax tree of every module; no broad `except` outside the two allowed files |

## 8. Gates and merge order

| Gate | Merges | Passes when |
| --- | --- | --- |
| G0 | The contracts, on `main` | Every contract suite passes against every fake; the boundary tests pass |
| G1 | AI | The five AI conformance suites pass. The live tests (a call to each model, and a Hindsight retain and recall round trip) have passed once by hand. |
| G2 | Backend | `BatonAPI` conformance passes; the six-act scenario tests pass on `FakeAIServices` |
| G3 | Frontend | Streamlit `AppTest` smoke tests pass on `FakeBaton`, then again on the real backend over `FakeAIServices` |
| G4 | Live integration: owners fix only | The real backend over the real AI: `check_setup` passes, `pytest -m live` passes, and the six acts run by hand |
| G5 | Demo and docs, on `main` | `measure_prefs` and `seed_demo` run; README and ARCHITECTURE written; the README steps reproduce the demo from a fresh clone |

**Order:** G0, then G1, G2 and G3 in any order, then G4, then G5.

- **The frontend can merge early,** because `app.py` defaults to `BATON_BACKEND=fake` until G4 switches the default to `real`.
- **After every merge,** each open branch rebases on `main` and runs the full suite.
- **Who fixes what:** a test that fails after a rebase belongs to the branch owner. The exception is a failing contract test, which goes back to the contract on `main`.

**Definition of done for a sector:**
- Its own tests and its conformance tests pass, and so does the full suite after rebasing on `main`.
- `check_ownership.py` passes, and so do the boundary tests.
- There are no TODOs left, and every public function has a docstring.

## 9. Sector briefs

### AI

**Start with the spikes** in design spec §21:
- the Gemini compatibility endpoint's 429 and strict schema;
- Qwen with thinking off;
- how many requests the burst needs;
- the Hindsight client on its own event-loop thread;
- verbatim mode, tags and metadata;
- how long a retain takes to become recallable.

**Then** build the models (§9 and §11) and memory (§12 and §14), and finish with `build_ai`.

**It needs** the Groq, Gemini and Hindsight keys, but only for the spikes and live tests. The conformance suites run offline.

### Backend

**Build the engine first.** It's pure functions, written test-first against design spec §7, §8.3, §10 and §13.

**Then** build the turn loop and `Baton` facade on `FakeAIServices`, with a scenario test for each demo act.

**The demo scripts** (`measure_prefs`, `seed_demo`) come after G4, because they need real models.

**It needs** no keys until G4.

### Frontend

**Goal:** build the design spec's §15 UI so that every control makes the `BatonAPI` call in the §5.3 table and renders the view it gets back.

**Imports:**
- `app.py` may import `build_baton` from `baton.backend.wiring`, and `baton.config`.
- `baton/ui/**` may import only `baton.interfaces` and Streamlit.

**Backend:** develop and test on `BATON_BACKEND=fake`. No keys are needed until G4.

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

**Tests:** `AppTest` smoke tests for each tab and each kitchen-sink state, plus a test that every §5.3 table row's control calls its method.

## 10. Changes to the design spec

These are applied to `2026-09-29-baton-design.md` in the same commit as this document:
- **Three tiers** (frontend, backend, AI) replace the five layers, and the package layout is `baton/ui/`, `baton/backend/`, `baton/ai/`, plus the shared `baton/interfaces/` (§6).
- **The UI** talks only to `BatonAPI`. The backend talks to the AI tier only through `AIServices`.
- **The L1/L2 merge** is a backend function (`combine`), so the AI tier's memory code does I/O only (§12.4).
- **The retain outbox retry** is the backend's job, so `LongTermMemory` doesn't need the store (§12.5).
- **Naming:** the typed `Warning` is `Alert`, so it doesn't shadow Python's built-in `Warning`.
- **Backend switch:** `BATON_BACKEND=fake|real` chooses the backend.
