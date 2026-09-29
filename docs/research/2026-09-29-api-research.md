# Baton: API and research notes

Checked on 2026-09-29 against the official docs and the published client packages (`hindsight-client` 0.10.1, `groq` 1.7.0), before writing the design spec. When a fact here changes something in `docs/reports/project-report.md`, the spec's "Changes from the report" table records the change.

Items marked **Verify** are not settled by the docs. Phase 0 of the implementation plan tests each one against the real service.

## Groq

**Models.** Production: `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`. Preview: `qwen/qwen3.8-27b`, MiniMax M2.7. The report's Model B, `qwen/qwen3-32b`, is no longer listed. The text models have a 131,072-token context window.

**Free-tier limits**, from Groq's rate-limits page:

| Model | Requests/min | Requests/day | Tokens/min | Tokens/day |
| --- | --- | --- | --- | --- |
| `openai/gpt-oss-120b` | 30 | 1,000 | 8,000 | 200,000 |
| `openai/gpt-oss-20b` | 30 | 1,000 | 8,000 | 200,000 |
| `qwen/qwen3.8-27b` | 30 | 1,000 | 8,000 | 200,000 |

- Limits apply per organisation, so everyone using one key shares one quota.
- A 429 response carries a `retry-after` header in seconds, and Groq sets that header only on a 429. The `x-ratelimit-remaining-*` and `x-ratelimit-reset-*` headers report the remaining quota.
- Cached prompt tokens don't count toward rate limits, so a stable prompt prefix saves quota.

**Structured outputs.** Strict mode works on `gpt-oss-20b`, `gpt-oss-120b` and `qwen3.8-27b`. Request format: `response_format={"type": "json_schema", "json_schema": {"name": ..., "strict": true, "schema": ...}}`. Every property must be listed in `required`, and every object must set `additionalProperties: false`. An optional field is written as a union with `null`. A request with structured outputs can't also stream or use tools. Pydantic's default JSON schema leaves fields with defaults out of `required`, so Baton needs a helper that produces a strict schema.

**Qwen 3.8 27B reasoning.** Thinking is on by default. In `groq` 1.7.0, `reasoning_effort` takes `none`, `default`, `low`, `medium` or `high`, and `reasoning_format` takes `hidden`, `raw` or `parsed`. Simon Willison's review reports about 60K thinking tokens a turn at the default effort, against a limit of 8K tokens a minute. Baton therefore calls this model with `reasoning_effort="none"` and `reasoning_format="hidden"`.

**Verify:**
- How gpt-oss-120b's reasoning tokens count against the per-minute token limit, and whether `reasoning_effort="low"` keeps them small.
- That the `openai` SDK passes the Groq-only parameters through `extra_body`.

## Gemini

**Models**, from Google's models page:

| Model ID | Status | Google's description |
| --- | --- | --- |
| `gemini-3.5-flash` | Stable | "Legacy Flash model" |
| `gemini-3.5-flash-lite` | Stable | Fastest, cheapest 3.5 model |
| `gemini-3.8-flash` | Stable | Newest Flash, aimed at long software-engineering tasks |
| `gemini-3-flash-preview` | Preview | |

**Limits.** Gemini limits apply per Google Cloud project, not per API key, and requests-per-day quotas reset at midnight Pacific. Google publishes the free-tier numbers only in AI Studio, at aistudio.google.com/rate-limit. Third-party pages disagree about 3.5 Flash: one says 15 requests a minute and 1,500 a day, another about 20 a day. **Verify** the numbers for this project in AI Studio before sizing the seed and measurement scripts.

**429.** The API returns `429 RESOURCE_EXHAUSTED`. The docs don't say whether a retry delay comes back with it. **Verify** whether a `retry-after` header or a `RetryInfo.retryDelay` field in the body arrives through the compatibility endpoint.

**OpenAI compatibility (beta).**
- Base URL: `https://generativelanguage.googleapis.com/v1beta/openai/`. It works with the `openai` Python SDK.
- `reasoning_effort` maps `minimal` and `low` to low thinking, and passes `medium` and `high` through.
- **Thinking can't be turned off on Gemini 3.x Flash models.** Only 2.5 models accept `none`.
- `response_format` with a JSON schema is supported. **Verify** whether strict mode is honoured.

**Privacy.** On the free tier, Google may use prompts and responses to improve its products. Baton redacts secrets before storing anything, but the chat text itself still goes to the model, and the README has to say so.

## Hindsight

**Client.** `pip install hindsight-client` (0.10.1). It depends on `aiohttp` and `pydantic>=2`. Usage: `from hindsight_client import Hindsight`, then `Hindsight(base_url=..., api_key=..., timeout=30.0)`.

**Cloud.** The base URL is `https://api.hindsight.vectorize.io`, with auth as `Authorization: Bearer <key>`. A 402 status means the account is out of credits. Banks are created implicitly on first use, and `create_bank` creates or updates one.

**`create_bank` parameters that matter to Baton:**
- `mission`, `disposition` (skepticism, literalism and empathy, each 1 to 5), `reflect_mission`.
- `retain_extraction_mode`: one of `concise` (the default), `verbose`, `custom`, `verbatim` or `chunks`. **The default mode rewrites stored text through an LLM**, so a `[REJECTED] Redis ...` line can come back paraphrased. **Verify** that `verbatim` keeps the text as written.
- `enable_observations` and `observations_mission`, which steer what gets consolidated into observations.

**Retain.**
- `retain(bank_id, content, context, timestamp, document_id, metadata, tags, retain_async, ...)` stores one item.
- `retain_batch(bank_id, items, document_id, document_tags, retain_async)` stores several. Each item can have `content`, `timestamp`, `context`, `metadata`, `document_id`, `entities`, `tags`, `observation_scopes` and `strategy`.
- `metadata` must be `dict[str, str]`: string values only.
- **A `document_id` replaces what's there.** If the document already exists, Hindsight deletes it and all its memories before processing the new content. Without a `document_id`, every call creates new memories.
- With `retain_async=True`, the call returns an `operation_id` at once. The docs give no time for how long until the item can be recalled. **Verify.**

**Recall.**
- Signature: `recall(bank_id, query, types, max_tokens=4096, budget="mid", tags, tags_match="any", prefer_observations, query_timestamp, ...)`. `arecall` is the async version.
- `types` can include `world`, `experience` and `observation`; leaving it out searches all three.
- `budget` is `low`, `mid` or `high`.
- `tags_match` is `any`, `all`, `any_strict`, `all_strict` or `exact`. The plain `any` and `all` modes also return untagged memories.
- Result fields: `id`, `text`, `type`, `context`, `metadata`, `tags`, `entities`, `occurred_start`, `occurred_end`, `mentioned_at`, `document_id`, `chunk_id`.
- There is no metadata filter. Filtering works through the query, `types`, `tags` and time windows.
- Four strategies run in parallel (semantic, BM25 keyword, entity graph and temporal) and are merged with reciprocal rank fusion.

**Reflect.** `reflect(bank_id, query, budget, context, tags, tags_match, apply_all_directives, ...)` returns a response with `.text`. **Verify** whether the response lists the source facts it used.

**Observations.** Hindsight consolidates observations in the background after each retain, and the docs give no timing. Consolidation can also be triggered by hand with `POST /v1/default/banks/{bank_id}/consolidate`. By default, observations are scoped to each item's full combination of tags.

**Directives and mental models.** Both exist in 0.10.1, as `client.directives` and `client.mental_models` (the low-level generated APIs). **Verify** the exact calls for creating a directive.

**Client internals** that affect Baton's design:
- The sync methods run their coroutine with `loop.run_until_complete` on the calling thread's event loop. A single client shared between Streamlit's script thread and a worker thread pool can hit "attached to a different loop" errors, so Baton gives the client one dedicated event-loop thread.
- Recall and reflect retry automatically on 429 and 503, honouring `Retry-After` with jitter. A synchronous retain is never retried.

**Research.** The Hindsight paper is arXiv 2512.12818. It reports state-of-the-art results on LongMemEval, and the project says others have reproduced them.

## R&D-Agent(Q)

**Paper.** "R&D-Agent-Quant: A Multi-Agent Framework for Data-Centric Factors and Model Joint Optimization", Yuante Li et al., NeurIPS 2025, arXiv 2505.15155. The code is at github.com/microsoft/RD-Agent.

**The loop.** A research stage proposes hypotheses. A development stage, run by the Co-STEER agent, turns them into code. A feedback stage runs the code as real-market backtests, and the backtest decides whether an idea worked, not an LLM. A Thompson-sampling multi-armed bandit chooses the next direction to try (a new factor or a new model), balancing exploration against exploitation. The paper reports up to 2x higher annualised returns than classical factor libraries while using 70% fewer factors.

**What Baton borrows:**

| R&D-Agent(Q) | Baton |
| --- | --- |
| A backtest decides whether an idea worked | Code (the verifier) decides whether a reply followed the contract |
| Results feed the next iteration | A failed check escalates that check's patch and triggers one retry |
| A bandit picks the next direction | Pass rates pick the starting patch level for each model and check. A bandit is on the roadmap. |

Baton doesn't borrow the code generation or the multi-agent research loop. The RD-Agent repository was not reviewed in depth, because the paper covers the ideas Baton uses.

## Competitors

The report's comparison (Mem0 OpenMemory, the Supermemory extension, the Hindsight ChatGPT connector) was not re-checked here.

## Sources

- Groq: [rate limits](https://console.groq.com/docs/rate-limits), [models](https://console.groq.com/docs/models), [Qwen 3.8 27B](https://console.groq.com/docs/model/qwen/qwen3.8-27b), [structured outputs](https://console.groq.com/docs/structured-outputs), [reasoning](https://console.groq.com/docs/reasoning)
- [Simon Willison on Qwen 3.8 27B](https://simonwillison.net/2026/Aug/16/qwen-38-27b/)
- Gemini: [models](https://ai.google.dev/gemini-api/docs/models), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)
- Hindsight: [Python client](https://hindsight.vectorize.io/sdks/python), [retain](https://hindsight.vectorize.io/developer/api/retain), [recall](https://hindsight.vectorize.io/developer/api/recall), [observations](https://hindsight.vectorize.io/developer/observations), [Cloud API](https://docs.hindsight.vectorize.io/api-integration/), [GitHub](https://github.com/vectorize-io/hindsight)
- [R&D-Agent(Q), arXiv 2505.15155](https://arxiv.org/abs/2505.15155), [microsoft/RD-Agent](https://github.com/microsoft/RD-Agent)
