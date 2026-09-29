# Baton: remaining work

Last updated: 2026-09-30. Based on `planv2.md` and the completed backend pass.
See [done.md](done.md) for implemented and verified work.

**Do not treat B6 or live end-to-end integration as complete.** Backend B1-B5 and
the shared prerequisites are implemented; the items below remain unfinished or
unverified. No commits or pushes were made during this work.

## 1. B6: connect and verify real apps

Owner: backend engineer with the integration lead/account owner.

- [ ] Set a stable private `BATON_MCP_TOKEN` in the ignored `.env` before saving
  lasting client configuration. Without it, the random token changes on restart.
- [ ] Merge the generated Baton config into the intended Claude Desktop config,
  restart Claude and confirm all five tools are listed.
- [ ] Ask Claude to pick up the baton for a test project and verify an actual
  app-generated pull event through `GET /api/projects/{project}/bridge`.
- [ ] Verify Claude calls `check_reply`, receives a failure for a rejected
  approach, revises its draft and obtains a pass.
- [ ] Check whether the user's ChatGPT account/workspace permits the required
  custom connector setup. Account access and availability are unverified.
- [ ] If connecting a remote app, tunnel the MCP-only listener, set
  `BATON_PUBLIC_URL`, restart the backend and connect the generated app URL.
  Do not tunnel the management/API listener.
- [ ] Verify a real ChatGPT record/import is visible on Claude's next pull.
- [ ] Optionally connect claude.ai through its generated public Claude URL.

**What stopped the previous attempt:** Claude Desktop was opened, its observed
window was blank, and the user stopped Computer Use before client setup or
verification. No Claude configuration was changed and no public tunnel was
opened. The passing localhost SDK test is not a substitute for these app checks.

A config was found at `%LOCALAPPDATA%\Claude-3p\claude_desktop_config.json`;
confirm the intended installation before applying configuration. The helper and
run instructions are in [the backend handoff](baton/backend/PLAN_V2_HANDOFF.md).

## 2. AI-owner implementation and live verification

These were outside the completed backend changes; do not assume completion.

- [ ] A1: run live Groq/Gemini completion and strict-schema extraction checks;
  record latencies and provider behavior in the plan's live findings document.
- [ ] Verify Hindsight retain-to-recall delay and preservation of item ids,
  kinds and aliases. Offline/scripted tests do not prove this.
- [ ] A2: address and test the Hindsight startup-failure fallback described in
  the plan; existing provider/Hindsight startup code was not changed here.
- [ ] A4: add the optional `openai:` provider seam and associated configuration
  if still required by the integration lead.
- [ ] Align burst failure handling in `baton/ai/chain.py`: its `bad_request`
  branch still disables the model, unlike the turn runner's skip-only policy.
- [ ] Run real 429/burst and post-merge live checks with the integration lead.

A3 bridge storage support has already been implemented and tested in this
checkout. Review/integrate that work rather than rebuilding it independently.

## 3. Frontend and cross-sector acceptance

Owner: frontend engineer and integration lead. Frontend work was not changed or
verified during this backend pass.

- [ ] Mirror the additive v2 HTTP types in `web/src/api/contract.ts` and add
  client methods for the three bridge endpoints.
- [ ] Complete/verify `/bridge`: app lanes, shared contract, rejection ledger,
  activity timeline, connection state and counters.
- [ ] Wire the Setup panel and Import box to the backend; retain clear mock-mode
  behavior and the manual import/copy fallback.
- [ ] Run frontend tests and production build; verify `/app` and `/bridge`
  against the live backend, including transcript recovery after restart.
- [ ] Confirm actual app events appear on the Bridge page within the plan's
  two-second target; no frontend timing claim has been verified.
- [ ] Rehearse the full real-provider path: extraction -> SQLite -> Hindsight
  retain -> handoff recall -> contract injection -> check -> repair.

## 4. Known backend limitations / follow-up improvements

These are hardening or product improvements, not missing B3-B5 route/tool code.

- [ ] Project/user authorization and standard MCP authorization for production.
  The prototype's secret URLs grant access to all projects. The separate public
  listener protects management routes but does not add project-level access control.
- [ ] Idempotency for repeated client writes and transactional item/event writes.
- [ ] Durable retain outbox/retry and recovery from partial SQLite/L2 updates.
- [ ] Cross-process coordination for complete bridge operations. SQLite session
  creation and turn reservation are atomic; project operation locks are local to
  one process. Use one worker until this is addressed.
- [ ] Persist historical per-turn alerts and fallback contracts for exact replay;
  current restart recovery restores replies, attempts, checks and handoffs.
- [ ] Persist/review recall trace history and verify its restart behavior.
- [ ] Broaden failure-path evidence where needed, including live extraction and
  LTM failures; do not describe redaction as exhaustively certified.
- [ ] Optional product improvements: contradictory-decision detection, import
  diffs with user evidence, and measured continuity/repair performance.

## 5. Integration lead and deliverables

- [ ] Review and integrate the shared types/settings/dependency/SQLite additions
  alongside other sectors' work; update ownership/setup docs as appropriate.
- [ ] Refresh README and demo script around the bridge, relative documentation
  links, connection setup and limitations.
- [ ] Run combined acceptance checks after integration and rehearse the demo.
- [ ] Complete the video/article/submission deliverables from the plan and check
  their wording against verified prototype behavior.

Committing, pushing, merging and publishing were not performed or authorized by
these documentation updates. The user's no-commit/no-push instruction remains in
force. The plan's dated schedule is historical context, not proof of delivery.
