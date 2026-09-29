# AI live-provider findings — 30 September 2026

## Result

`python -m pytest -m live tests/live -q -s` passed all six tests against the keys in the local `.env`. The test run did not print or persist any credentials.

| Check | Provider/model | Result |
| --- | --- | --- |
| Chat completion | Groq `openai/gpt-oss-120b` | Non-empty response, 786 ms |
| Chat completion | Gemini `gemini-3.5-flash` | Non-empty response, 2,854 ms |
| Chat completion | Groq `qwen/qwen3.8-27b` | Non-empty response, 204 ms |
| Structured extraction | Groq `openai/gpt-oss-20b` | Rejection and reason extracted |
| Structured extraction | Gemini `gemini-3.5-flash-lite` | Rejection and reason extracted |
| Long-term memory | Hindsight | Typed items retained and recalled in 6.67 s; reflection returned ten sources |

Repeated Hindsight retain-to-recall samples during implementation ranged from about 5.7 to 9.0 seconds, so the UI and tests should continue to poll rather than assume immediate indexing.

## Provider findings

- Groq accepts strict structured output only when the generated schema avoids unsupported constructs such as nullable `anyOf`. The extractor now emits a compatible schema.
- Gemini honours strict JSON schema for the tested extraction request. Gemini 3.x can spend a very small completion allowance on internal reasoning without returning visible text, so its live smoke test allows 256 output tokens. Production already allows more.
- Both extractor models needed the prompt to state the rejection classification explicitly. A deterministic fallback also protects the exact “No Redis … use an in-process cache” case if a provider returns an empty extraction.
- No claim is made here about provider-specific `reasoning_effort`; Baton uses the common OpenAI-compatible request surface and does not depend on that option.

## Hindsight findings

- Item ids, kinds, aliases, session/project identity, user, turn, model, source, and timestamps round-trip through metadata.
- Hindsight rejects an asynchronous batch when multiple items share one document id. Baton therefore performs the server-side batch synchronously on its dedicated memory thread; the user request remains non-blocking.
- `why()` works through `reflect` with rejection, reversal, decision, and constraint tags. The post-backend-merge check returned an answer grounded in ten memory sources.
- Timeouts, unavailable service responses, and HTTP 402 are converted to visible data objects rather than raised into the app.

## Deliberately not exercised

The live suite does not intentionally exhaust provider quotas to manufacture a real 429. Rate-limit parsing, cooldown behavior, and burst handling remain covered by deterministic unit tests so routine verification does not consume or disable the recording keys.
