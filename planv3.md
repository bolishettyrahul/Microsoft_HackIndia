# Baton plan v3: the report's gaps plus the v2 bridge, divided by role

> Written 01:15 IST, 30 Sep 2026. Deadline **09:00 IST**. v3 extends `planv2.md`; it doesn't replace it.
> Every v2 task keeps its ID and detail (A1–A5, B1–B6, F1–F6). This file adds new tasks, an updated
> clock and priority tiers. Same rules as v2 §0.3. Nothing public may contain the word "hackathon".

## 0. Shared context

### 0.1 The report against what's built

The report (`docs/reports/project-report.md`) promised four moves. Status on `main` (`a7da914`):

| Report move | Built? | Gap |
| --- | --- | --- |
| 1. Carry task state as a typed contract | Yes: `contract.py`, extractor, L1 + L2 | Never run on real keys |
| 2. Rejection ledger | Yes: ledger, reverse, aliases | "Why did we reject this?" (reflect) not built |
| 3. Verify with code, repair once | Partly: 3 of 7 checks; repair always at level 1 | max_words, no_emojis, no_preamble and code_language missing |
| 4. Learn which patch works for each model | **No** | No `patch_stats`, no level choice, no learning chart |

Also missing from the report: seeding, the team view, and the "Model learning" tab.
Built beyond the report: the HTTP API (it became the backbone), the React UI, the 3D landing page.

### 0.2 What v3 adds

- **Tier 1, must ship by 09:00:** all of v2 (the bridge, MCP, bug fixes, live check), re-timed below.
- **Tier 2, cheap and visible, ship if Tier 1 is on time:** the extra checks, the restart-safe transcript UI, a guided demo rail, who-recorded-it on `/bridge`.
- **Tier 3, the report's fourth move:** patch stats, choosing the patch level, the learning chart, and "Why?". It needs the §0.3 contracts.
- **Hard cutoff: 06:00.** Anything not merged by then is dropped and goes in the README's Limitations.

### 0.3 Contracts v3 (the integration lead lands these **with** v2 §0.4, in one commit; additive only)

`CONTRACT_VERSION` becomes `"2h-3.0"`.

```python
# baton/interfaces/types.py
class CheckId(StrEnum):            # add these; existing values are unchanged
    MAX_WORDS = "max_words"; NO_EMOJIS = "no_emojis"; NO_PREAMBLE = "no_preamble"; CODE_LANGUAGE = "code_language"

class Preferences(Frozen):         # new fields have defaults, so old callers are unaffected
    no_bullets: bool = False
    max_words: int | None = None
    no_emojis: bool = False
    no_preamble: bool = False
    code_languages: tuple[str, ...] | None = None   # None = check off
    free_text: tuple[str, ...] = ()

class PatchStat(Frozen):
    model: str; check_id: CheckId; level: int; passes: int; trials: int

class WhyAnswer(Frozen):
    text: str | None; sources: tuple[str, ...] = (); error: str | None = None

# baton/interfaces/ai.py
# Store:          record_check(model, check_id, level, passed) -> None
#                 patch_stats(model: str | None = None) -> list[PatchStat]
#                 first_attempt_rates(project) -> list[tuple[str, str, datetime, int, int]]  # model, session, at, checks, failures
# LongTermMemory: why(project, approach) -> WhyAnswer   # reflect, 20 s timeout, never raises

# baton/interfaces/api.py  (mirrored in web/src/api/contract.ts)
class LearningPoint(Frozen): model: str; session_id: str; at: datetime; checks: int; failures: int
class LearningView(Frozen):  stats: tuple[PatchStat, ...]; points: tuple[LearningPoint, ...]; alerts: tuple[Alert, ...] = ()
class WhyView(Frozen):       item_id: str; approach: str; answer: str | None; sources: tuple[str, ...] = (); error: str | None = None
class AskWhy(Frozen):        item_id: str
# GET  /api/projects/{project}/learning        -> LearningView
# POST /api/sessions/{sid}/ledger/why   AskWhy -> WhyView
```

---

## 1. AI owner (`baton/ai/**`, `tests/ai/**`, `tests/live/**`)

**Tier 1, from v2 §1.3:**
- A1 live check (01:35–02:15)
- A2 Hindsight must never crash the app (02:15–02:30)
- A3 store support for the bridge (02:30–03:15)
- A4 `openai:` provider seam (03:15–03:30)
- A5 on call from 04:00

**Tier 3, new:**
- **A6. Patch stats in the store (03:30–04:00).**
  - A `patch_stats` table keyed on (model, check_id, level) with passes and trials.
  - `record_check` upserts it.
  - `patch_stats(model)` reads it.
  - `first_attempt_rates(project)` reads `verifications` joined with `messages`, where attempt is `first` and memory is on, grouped by (model, session).
  - Tests: upsert and totals; rates ignore repair and memory-OFF attempts.
- **A7. `why()` via Hindsight reflect (04:45–05:15).**
  - Uses `planv2`'s event-loop pattern.
  - The query is "Why did the team reject {approach}? Cite the turn, model and person.", with `budget="low"`, tags `kind:rejection|reversal|decision|constraint`, and a 20 s timeout.
  - Sources are taken from the reflect response.
  - A timeout or 402 becomes `error`; it never raises.
  - `UnavailableLongTermMemory.why` returns `error="long-term memory unavailable"`.
- **A8. Live re-check (05:30).** `pytest -m live` after the merge, and a fresh Groq key for recording.

**Done when:** v2 §1.5 holds, plus A6 tests pass and `why()` returns an answer or a visible error on a real bank.

---

## 2. Backend owner (`baton/backend/**`, `tests/backend/**`, `tests/integration/**`)

**Tier 1, from v2 §2.3:**
- B1 bugs 2–5 (01:35–02:15)
- B2 the integration test (02:15–02:30)
- B3 `bridge.py` (02:30–03:30)
- B4 the MCP tools, including a 15-minute spike (03:30–04:15)
- B5 the bridge endpoints (04:15–04:30)
- B6 connect the real apps, with the lead (04:45–05:30)

B1 also covers the two hardening items in `done.md`:
- save recall traces with `store.save_recall()`;
- retry un-retained items every 60 s and at startup.

**Tier 2, new:**
- **B7. The four extra checks (after B5, about 30 minutes)**, in `verifier.py`, following spec §10.1:
  - `max_words`: more than N words outside code fails; the evidence is "212 / 150 words".
  - `no_emojis`: emoji ranges; the evidence lists the emojis.
  - `no_preamble`: the first sentence opens with Great question, Sure, Certainly, Absolutely or Of course.
  - `code_language`: a fence with no tag, or a tag outside the allowed set.

  Plus a rule sentence per check in `compose._RULES`, and preferences applied from both `UpdateSession` and the extractor. Tests: pass and fail for each check, with code fences ignored.

**Tier 3, new:**
- **B8. Choose the patch level (spec §10.3)**, in `compose.py`/`turn.py`.
  - For each (model, check), look at levels 0 to 3 in order and pick the first that is proven good (at least 3 trials and at least an 80% pass rate) or untested (fewer than 3 trials). Skip levels proven bad. If every level is proven bad, use 3.
  - A repair escalates to level + 1, capped at 3.
  - With memory ON, record every attempt with `store.record_check`.
  - Tests: level choice across proven-good, proven-bad and untested levels; escalation.
- **B9. `GET /api/projects/{project}/learning` → `LearningView`**, built from `patch_stats` and `first_attempt_rates`.
- **B10. `POST /api/sessions/{sid}/ledger/why` → `WhyView`**, from `ai.memory.why`, cached per item until the ledger changes. It's never on the turn's hot path.
- **B11. `scripts/seed_demo.py`** (only if B8 has merged).
  - Runs 4 scripted sessions on *other* features (auth, logging) through the real backend, with memory ON, so the learning chart has history.
  - Resumable, and throttled to each model's requests-per-minute limit.

**Done when:** v2 §2.5 holds, plus the B7 checks show as chips live; B8–B10 are tested if they shipped.

---

## 3. Frontend owner (`web/**`, except `web/src/api/contract.ts`)

**Tier 1, from v2 §3.3.** One change: **don't wait for the contracts.**
- Build against a temporary `web/src/api/bridge.ts` that holds the v2 §0.4 types *exactly*.
- When `main` lands `contract.ts` v2 and v3, switch the imports and delete the temporary file (a one-file swap).

| Task | Time (IST) | What |
| --- | --- | --- |
| F1 | 01:15–01:45 | Fast-forward to `main`; `npm test` and `npm run build`; walk through `/app` in `dev:live` against `uvicorn` |
| F2 | 01:45–03:15 | The `/bridge` page (see below) |
| F3 | 03:15–03:40 | The Setup drawer |
| F4 | 03:40–04:00 | The Import box |
| F5 | alongside F2–F4 | Fake backend and tests |
| F6 | 05:30–06:15 | Landing chapter and 1080p polish |

**F2 detail:**
- `useBridge(project)` polls every 2 s.
- Three columns: a ChatGPT lane, the shared Baton, a Claude lane.
- Colours: ChatGPT fuchsia, Claude cyan, matching the 3D hero.
- A relay timeline, where each new event slides the baton between lanes.
- Reuse `Tabs.tsx`'s field, fold and line components, and `CopyButton`, `BatonMark` and `lib/lanes.ts`.

**Tier 2, new:**
- **F7. The chat after a restart (01:45, 10 minutes).** When a restored session has turns on the server but `/turns` comes back empty (bug 4, before B1 lands), the chat says "Earlier messages aren't available after a backend restart. The baton still has everything." instead of looking empty.
- **F8. A guided demo rail on `/app` (04:00–04:30).**
  - A thin step rail under the top bar: Plan → Hit 429 → Memory OFF → Re-run ON → Copy baton.
  - Each step is worked out from state (turns, models cooling, `session.memory_on`, `turn.rerun_memory_on`, a copy made).
  - The next action's button gets a soft pulse. It can be dismissed, and it respects reduced motion.
- **F9. Who recorded each item, on `/bridge` (04:30–04:45).** Each contract line shows the app, person and turn, from `ContractLine.user` and `model`. This is the report's "team view" with no backend work.
- **F10. Controls for the extra checks (with B7).** Max words (a number), No emojis, No preamble and Code languages, in the TopBar Controls menu, sent through `PATCH /sessions/{sid}` `prefs`. Chips render with no changes.

**Tier 3, new (after B9 and B10 merge):**
- **F11. A "Learning" tab and "Why?".**
  - **Learning:** a fourth panel tab. It shows first-attempt violation rate per model per session (a small line chart with lane colours; the empty state is "No history yet. Seed or run a few sessions.") and a patch-level table, level 0 to 3, per model and check.
  - **Why?:** a button on each ledger row. It shows the answer with its sources underneath, with a spinner and error state for the 20 s timeout.
  - Fake-backend data for both.

**Done when:** v2 §3.5 holds, plus F7 and F8 have merged; F9–F11 are merged if they shipped.

---

## 4. Integration lead (on `main`)

| Time (IST) | Task |
| --- | --- |
| 01:15–01:35 | **Late:** land the v2 §0.4 and v3 §0.3 contracts in one commit, plus `CLAUDE.md`, `requirements.txt` (`mcp`) and `.env.example` (`BATON_MCP_TOKEN`, `BATON_PUBLIC_URL`). Fast-forward the worktrees and tell the owners |
| 01:35–04:00 | Answer contract questions. Fix bug 6 (README links, the `docs/specs/` path). Write `docs/demo-script.md` |
| 04:00–04:45 | Merge AI → backend → frontend with `--no-ff`, then run `pytest -q`, `npm test`, `npm run build` and the HTTP integration test |
| 04:45–05:30 | Connect Claude Desktop and ChatGPT with the backend owner (B6) |
| 05:30–06:00 | Merge Tier 2 and 3 if ready. **06:00 is the hard cutoff** |
| 06:00–07:00 | Two full rehearsals; send fixes to their owners |
| 07:00–08:30 | Deliverables: the video, the article (`docs/articles/article.md`), the LinkedIn and Reddit posts, `done.md`, and the README's Limitations (list any tier that was dropped) |
| 08:30–09:00 | Buffer, final push, submit |

## 5. Demo script

As v2 §5, plus, if they shipped:
- **After the in-app engine, about 20 s:** "Why?" on Redis, and the Learning tab.
- **In the bridge part:** the guided rail on `/app` makes each act readable.

## 6. Verification

As v2 §7, plus:
- **Offline:** tests for the checks (B7), patch-level choice (B8) and learning rates (A6).
- **Live:** `why()` answers on a real bank.
- **UI:** Playwright drives the F8 rail through all five steps, and the F11 tab in fake-backend mode.
