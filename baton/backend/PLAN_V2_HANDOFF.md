# Backend review of plan v2

Reviewed against the local checkout on 2026-09-30. No commits or pushes were made.

## Ownership

The backend owner implements section 2: orchestration, contract merging and
verification, HTTP transport, bridge services, MCP transport, backend tests and
integration tests. Changes belong in `baton/backend/**`, `tests/backend/**` and
`tests/integration/**`.

Provider adapters, SQLite schema and Hindsight are the AI owner's work. Shared
interfaces, settings, dependencies and environment examples belong to the
integration lead. The web application belongs to the frontend owner.

## Current delivery

The follow-up request authorized implementing the missing shared backend types
and SQLite support here. Frontend files and model-provider adapters remain unchanged.

| Plan item | Status | Evidence |
| --- | --- | --- |
| B1 | Implemented and tested | Fake wiring, repair failure policy, error redaction, restart transcript and rerun continuity |
| B2 | Implemented and tested | All 17 original endpoints exercised using real AI adapter classes with scripted provider clients |
| B3 | Implemented and tested | `bridge.py`, shared extraction, durable external sessions, project-wide items, reversal resolution, activity and import events |
| B4 | Implemented and tested | Five FastMCP tools for each app, in-memory SDK test and mounted Streamable HTTP SDK test |
| B5 | Implemented and tested | Three typed HTTP endpoints plus connection URL/config generation |
| B6 | Local transport verified; app connection incomplete | Real localhost SDK calls passed; Claude Desktop was opened, but Computer Use was stopped by the user before client setup/verification |

The shared additions are in `baton/interfaces/**`, `baton/config.py`,
`requirements.txt`, `.env.example` and the bridge-specific SQLite methods/tables
in `baton/ai/store.py`. These are additive; the frontend can consume the plan's
three new response shapes when its owner adds the bridge page.

## Verification

- Final offline suite: **45 passed**. `git diff --check` passed.
- The offline suite covers the original flow, bridge service, all five tools,
  the SDK in-memory transport, two mounted Streamable HTTP servers, setup,
  invalid input, unknown token, untrusted hosts/origins, SQLite reopening,
  concurrent session creation/turn reservation and activity beyond 50 events.
- A running backend on localhost ports 8010/8011 was checked with the real MCP
  SDK client: ChatGPT recorded Redis as rejected; Claude pulled it and failed a
  draft suggesting Redis. The resulting events were record -> pull -> check.
- The tunnel listener returned 404 for management/setup routes.
- The localhost check used fake AI with explicitly supplied items. This proves
  MCP transport and backend behavior, not real provider extraction or app calls.
- No Claude configuration was changed and no public tunnel was opened. Claude
  Desktop's observed window was blank; Computer Use was stopped by the user.
  ChatGPT account access and connector availability were not verified.

## Run and connect

Use the project virtual environment (the MCP SDK was installed there):

```powershell
.\.venv\Scripts\python.exe -m baton.backend.serve
```

This runs the local API on port 8000 and an MCP-only listener on port 8001.
If those ports are busy, use `--port 8010 --public-port 8011`. The setup endpoint
uses the port from the incoming request, so the returned config stays correct.
Set `BATON_AI=fake` for a provider-free check. Fake extraction returns no items
unless scripted by a test; use `record_items` for a no-key bridge demonstration.

Set a random `BATON_MCP_TOKEN` in the ignored `.env` before creating a lasting
client configuration; otherwise the generated token changes on backend restart.
Open `http://localhost:8000/api/bridge/setup` for the Claude config and URLs.

To merge the config while preserving existing settings and making a backup:

```powershell
.\.venv\Scripts\python.exe -m baton.backend.connect_claude --url http://localhost:8000 --config "$env:APPDATA\Claude\claude_desktop_config.json"
```

On this machine an existing config was found instead at
`%LOCALAPPDATA%\Claude-3p\claude_desktop_config.json`; use the config belonging to
whichever Claude installation you intend to connect. Restart Claude Desktop and
confirm all five Baton tools appear, then ask it to pick up the baton for demo.
Use `GET /api/projects/demo/bridge` to verify its pull/check events.

For ChatGPT or claude.ai, tunnel only the MCP listener:

```powershell
cloudflared tunnel --url http://localhost:8001
```

Set `BATON_PUBLIC_URL` to the resulting HTTPS origin and restart the backend.
Copy the appropriate public URL from the local setup endpoint. The public origin
is explicitly permitted by MCP host/origin checks. Do not tunnel port 8000.
Current [OpenAI connection guidance](https://developers.openai.com/plugins/deploy/connect-chatgpt)
places Developer mode under Settings -> Security and login, then adds servers
from Plugins. Availability depends on account/workspace policy. If unavailable,
use the import endpoint plus the rendered contract as the manual bridge.

## Remaining limitations

- External app approval/login/connector setup and a real app-generated tool call
  remain B6 acceptance steps; no claim of completion is made for them.
- Token URLs grant access to all projects in this local prototype. Production
  needs user/project authorization and standard MCP authorization.
- Project locks serialize work within one backend process. SQLite reserves unique
  sessions/turns across threads/processes, but item, event and L2 retention writes
  are not one transaction; use one backend worker for this prototype.
- No automatic retries/idempotency are implemented for repeated client writes.
- Existing provider/Hindsight startup behavior is unchanged. A provider-free
  transport check does not certify real extraction or long-term retention.

## Project improvements, in priority order

1. **Protect the whole public surface.** The proposed tunnel exposes port 8000,
   including the existing unauthenticated `/api` routes. A secret MCP path does
   not protect them, and the future setup route would reveal connection URLs.
   Keep setup local; authorize access per project and separate public MCP access
   from local management endpoints. For production MCP, follow the official
   [authorization specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/basic/authorization.mdx).
2. **Make retried writes safe.** Add request idempotency keys and transactional
   item/event writes so reconnects cannot duplicate decisions or reversals.
   This needs an integration-owned API contract and AI-owned storage changes.
3. **Show conflicting decisions.** Surface contradictory decisions from different
   apps with provenance and explicit resolution instead of silently selecting
   the latest. Backend detects conflicts; frontend displays them.
4. **Show a baton diff.** After an import or record, display what was added,
   rejected, reversed or resolved. Include the original user evidence so users
   can correct a mistaken extraction. This is a shared product/API addition.
5. **Measure continuity.** Maintain a small offline scenario set and report
   rejected-approach recurrence, successful repairs, false positives, handoff
   latency and restoration correctness. Keep scripted and live evidence separate.
6. **Preserve recovery metadata.** Current Store records do not retain per-turn
   alerts or the historical fallback contract. Restored replies and checks work,
   but exact replay of those fields needs an agreed durable turn outcome record.

Additional owner-specific finding: `baton/ai/chain.py` still disables a model on
`bad_request` during burst. Its AI owner should align that behavior with the
plan's skip-only policy; this backend change does not edit the AI implementation.
