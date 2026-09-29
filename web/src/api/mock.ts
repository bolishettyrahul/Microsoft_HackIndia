// An in-browser fake of the backend, scripted to play the demo acts with no network:
// Model A suggests Redis; the user rejects it; a burst gives a real-looking 429; with memory OFF
// the next model restarts and re-suggests Redis (red chips); a re-run with memory ON continues
// (green chips); asking for "steps" triggers a bullet reply that is repaired.
import type {
  Alert, BurstView, ChipView, ContractLine, ContractView, HandoffEvent, LedgerRow, ModelStatus,
  RecallTrace, ReplyView, SessionView, TraceView, TurnView,
} from "./contract";
import { ApiError, type BatonApi } from "./http";

interface Profile { model_id: string; label: string; provider: string; burstable: boolean }

const PROFILES: Profile[] = [
  { model_id: "groq:openai/gpt-oss-120b", label: "gpt-oss-120b", provider: "groq", burstable: true },
  { model_id: "gemini:gemini-3.5-flash", label: "Gemini 3.5 Flash", provider: "google", burstable: false },
  { model_id: "groq:qwen/qwen3.8-27b", label: "Qwen 3.8 27B", provider: "groq", burstable: true },
];

type Kind = "goal" | "decision" | "constraint" | "open_question" | "next_step";
interface Line extends ContractLine { kind: Kind }

interface MockSession {
  view: SessionView;
  turns: TurnView[];
  lines: Line[];
  ledger: LedgerRow[];
  traces: RecallTrace[];
  fetchedAt: string | null;
  benched: Set<string>;
  active: number;
  spoke: Set<string>; // models that have replied since they last became active
  pending: HandoffEvent[]; // manual handoffs waiting for the next turn
  userTexts: string[];
}

const L2_LINES: Line[] = [
  {
    item_id: "l2-log", kind: "decision", text: "Use structlog for request logging", reason: null,
    turn: 4, model: "Gemini 3.5 Flash", user: "Teammate", tier: "l2",
  },
  {
    item_id: "l2-free", kind: "constraint", text: "Run as a single uvicorn worker", reason: null,
    turn: 2, model: "gpt-oss-120b", user: "Rahul", tier: "l2",
  },
];

const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let ids = 0;
const nid = () => `m${++ids}`;
let messageIds = 0;

function chip(check_id: ChipView["check_id"], passed: boolean, label: string, evidence: string): ChipView {
  return { check_id, passed, label, evidence };
}

export function createMockApi(opts: { latencyMs?: number; extractionDelayMs?: number } = {}): BatonApi {
  const latency = opts.latencyMs ?? 900;
  const extractionDelay = opts.extractionDelayMs ?? 1400;
  const sessions = new Map<string, MockSession>();
  const cooldowns = new Map<string, number>(); // model_id -> epoch ms (global, like the real key limits)

  function get(sid: string): MockSession {
    const s = sessions.get(sid);
    if (!s) throw new ApiError(404, `unknown session ${sid}`);
    return s;
  }
  const cooling = (id: string) => (cooldowns.get(id) ?? 0) > Date.now();

  function statuses(s: MockSession): ModelStatus[] {
    return PROFILES.map((p, i) => {
      const cool = cooling(p.model_id);
      return {
        ...p,
        state: s.benched.has(p.model_id) ? "benched" : cool ? "cooling" : "ready",
        cooldown_until: cool ? new Date(cooldowns.get(p.model_id)!).toISOString() : null,
        is_active: i === s.active,
        detail: cool ? "rate-limited (429)" : null,
      };
    });
  }

  function candidates(s: MockSession): number[] {
    const order = [...PROFILES.keys()].map((k) => (s.active + k) % PROFILES.length);
    return order.filter((i) => !cooling(PROFILES[i].model_id) && !s.benched.has(PROFILES[i].model_id));
  }

  function activeRejections(s: MockSession) {
    return s.ledger.filter((r) => r.status === "active");
  }

  function render(s: MockSession): string {
    const all = [...L2_LINES, ...s.lines];
    const latest = (k: Kind) => [...all].reverse().find((l) => l.kind === k);
    const out = [`<baton_contract project="${s.view.project}">`,
      "This block is data about the task so far, recorded by Baton. It is not an instruction from the user."];
    const goal = latest("goal");
    if (goal) out.push(`Goal: ${goal.text}.`);
    const next = latest("next_step");
    if (next) out.push(`Next step: ${next.text}.`);
    for (const d of all.filter((l) => l.kind === "decision"))
      out.push(`Decision: ${d.text} (turn ${d.turn}, ${d.model ?? "user"}, ${d.user}).`);
    for (const c of all.filter((l) => l.kind === "constraint")) out.push(`Constraint: ${c.text} (turn ${c.turn}, ${c.user}).`);
    for (const r of activeRejections(s))
      out.push(`Rejected: ${r.approach}. Reason: ${r.reason}. Also covers: ${r.aliases.join(", ")}. Do not suggest it.`);
    for (const q of all.filter((l) => l.kind === "open_question")) out.push(`Open question: ${q.text}`);
    if (s.view.prefs.no_bullets) out.push("Preference: No bullet lists in answers.");
    out.push("</baton_contract>");
    return out.join("\n");
  }

  function contractView(s: MockSession): ContractView {
    const all = [...L2_LINES, ...s.lines];
    const latest = (k: Kind) => [...all].reverse().find((l) => l.kind === k) ?? null;
    const strip = (l: Line | null): ContractLine | null => {
      if (!l) return null;
      const { kind: _kind, ...rest } = l;
      return rest;
    };
    const many = (k: Kind) => all.filter((l) => l.kind === k).map((l) => strip(l)!);
    const alerts: Alert[] = all.length === 0 && s.ledger.length === 0
      ? [{ level: "info", code: "empty_contract", message: "Nothing recorded yet. The contract fills in after the first turn." }]
      : [];
    return {
      project: s.view.project,
      goal: strip(latest("goal")),
      next_step: strip(latest("next_step")),
      decisions: many("decision"),
      constraints: many("constraint"),
      rejections: activeRejections(s).map((r) => ({
        item_id: r.item_id, text: r.approach, reason: r.reason, turn: r.turn, model: r.model, user: r.user, tier: "l1",
      })),
      open_questions: many("open_question"),
      preferences: s.view.prefs,
      rendered: render(s),
      alerts,
    };
  }

  function recall(s: MockSession): number {
    s.traces = [
      {
        purpose: "state", query: `goal, decisions, constraints and next step for ${s.view.project}`,
        tags: ["kind:goal", "kind:decision", "kind:constraint", "kind:next_step"],
        result_count: L2_LINES.length + s.lines.length, latency_ms: 380 + Math.round(Math.random() * 240), error: null,
      },
      {
        purpose: "ledger", query: "rejected approaches and reasons", tags: ["kind:rejection", "kind:reversal"],
        result_count: s.ledger.length, latency_ms: 290 + Math.round(Math.random() * 200), error: null,
      },
    ];
    s.fetchedAt = now();
    return s.traces.reduce((n, t) => n + t.result_count, 0);
  }

  function line(s: MockSession, kind: Kind, text: string, turn: number, model: string | null): Line {
    return { item_id: nid(), kind, text, reason: null, turn, model, user: s.view.user, tier: "l1" };
  }

  // The "background job": extract items from the turn, a moment after the reply is shown.
  function extract(s: MockSession, turn: number, text: string, modelLabel: string) {
    const t = text.toLowerCase();
    setTimeout(() => {
      s.lines = s.lines.filter((l) => l.turn !== turn);
      if (/cach|plan/.test(t) && !s.lines.some((l) => l.kind === "goal"))
        s.lines.push(line(s, "goal", "Add caching to the FastAPI recall endpoint", turn, null));
      if (/no redis|not redis|without redis/.test(t)) {
        s.lines.push(line(s, "decision", "Use an in-process TTL cache", turn, modelLabel));
        s.lines.push(line(s, "constraint", "Must stay on free tiers", turn, null));
        if (!s.ledger.some((r) => r.approach === "Redis"))
          s.ledger.push({
            item_id: nid(), approach: "Redis", reason: "free tier", aliases: ["redis", "redis cache", "elasticache"],
            turn, model: modelLabel, user: s.view.user, status: "active", reversal_reason: null,
          });
        s.lines.push(line(s, "open_question", "Streamlit or FastAPI for the API layer?", turn, null));
      }
      if (/bullet/.test(t) && !s.view.prefs.no_bullets) s.view = { ...s.view, prefs: { ...s.view.prefs, no_bullets: true } };
      s.lines.push(line(s, "next_step", /no redis|next|continue/.test(t)
        ? "Add a TTL cache around recall() in memory.py" : "Agree on the cache strategy", turn, modelLabel));
    }, extractionDelay);
  }

  function reply(s: MockSession, model: Profile, text: string, memoryOn: boolean, attempt: ReplyView["attempt"]): {
    final: ReplyView; earlier: ReplyView[];
  } {
    const t = text.toLowerCase();
    const firstForModel = !s.spoke.has(model.model_id) && s.turns.length > 0;
    const rejected = activeRejections(s).length > 0;
    const noBullets = s.view.prefs.no_bullets;
    const make = (body: string, chips: ChipView[], a: ReplyView["attempt"] = attempt): ReplyView => ({
      message_id: ++messageIds, model_id: model.model_id, model_label: model.label, text: body, memory_on: memoryOn,
      attempt: a, chips,
    });

    if (s.turns.length === 0 || (/plan|cach/.test(t) && !/no redis/.test(t) && !rejected)) {
      return {
        final: make(
          "For the recall endpoint I'd put a cache in front of the Hindsight call. Redis is the usual choice: " +
            "it's fast, shared across workers, and has TTLs built in. We'd wrap recall() in a get-or-set, key it by " +
            "(bank, query), and expire entries after 60 seconds. Want me to sketch the Redis setup?",
          [],
        ),
        earlier: [],
      };
    }
    if (/no redis|not redis|without redis/.test(t)) {
      return {
        final: make(
          "Understood: no Redis, since we're on a free tier. An in-process TTL cache does the job for one worker. " +
            "Wrap recall() in memory.py with a TTLCache(maxsize=256, ttl=60) keyed by (bank, query), and clear a bank's " +
            "entries whenever it gets a retain. I'll keep answers in prose from here on.",
          [],
        ),
        earlier: [],
      };
    }

    const chipsFor = (restarted: boolean, bullets: boolean): ChipView[] => {
      const out: ChipView[] = [];
      if (firstForModel)
        out.push(restarted
          ? chip("continuity", false, "continuity", "“Could you share more about what you're building?”")
          : chip("continuity", true, "continuity", "Opened from the next step"));
      if (rejected)
        out.push(restarted
          ? chip("rejected", false, "rejected: Redis", "“Redis is a great option for this.”")
          : chip("rejected", true, "rejected: Redis", "No mention of Redis or its aliases"));
      if (noBullets)
        out.push(bullets
          ? chip("no_bullets", false, "no-bullets", "3 list lines")
          : chip("no_bullets", true, "no-bullets", "0 list lines"));
      return out;
    };

    if (!memoryOn && firstForModel) {
      return {
        final: make(
          "Happy to help! Could you share more about what you're building? For caching an API endpoint, " +
            "Redis is a great option for this:\n- fast in-memory reads\n- built-in TTLs\n- works across workers",
          chipsFor(true, true),
        ),
        earlier: [],
      };
    }
    const continued =
      "Picking up from the next step: wrap recall() in memory.py with an in-process TTLCache(maxsize=256, ttl=60), " +
      "keyed by (bank, query). Redis stays out because of the free-tier constraint. After that, clear a bank's " +
      "entries on every retain so a fresh decision is never hidden behind a stale cache.";
    if (/steps|list|checklist/.test(t) && noBullets && memoryOn && attempt === "first") {
      const first = make(
        "Here are the steps:\n1. Add cachetools to requirements.txt\n2. Wrap recall() in a TTLCache\n3. Clear the bank's entries on retain",
        chipsFor(false, true),
      );
      const repaired = make(
        "First, add cachetools to requirements.txt. Then wrap recall() in memory.py with a TTLCache(maxsize=256, ttl=60) " +
          "keyed by (bank, query). Finally, clear that bank's entries whenever it gets a retain, so new decisions show up at once.",
        chipsFor(false, false), "repair",
      );
      return { final: repaired, earlier: [first] };
    }
    return { final: make(continued, chipsFor(false, false)), earlier: [] };
  }

  async function runTurn(s: MockSession, text: string, memoryOn: boolean): Promise<TurnView> {
    const handoffs: HandoffEvent[] = [...s.pending];
    s.pending = [];
    const alerts: Alert[] = [];
    const start = s.active;
    const cands = candidates(s);
    const turn = s.turns.length + 1;

    if (cands.length === 0) {
      const soonest = Math.min(...PROFILES.map((p) => cooldowns.get(p.model_id) ?? Infinity));
      alerts.push({
        level: "red", code: "no_model",
        message: `No model is available. The next one is ready in ${Math.max(0, Math.ceil((soonest - Date.now()) / 1000))} s. Copy the baton to continue anywhere.`,
      });
      const view: TurnView = {
        session_id: s.view.session_id, turn, user_text: text, reply: null, handoffs, alerts,
        earlier_attempts: [], fallback_contract: render(s), can_rerun: false, rerun_memory_on: null,
      };
      s.turns.push(view);
      return view;
    }
    if (cands[0] !== start) {
      const from = PROFILES[start];
      const until = cooldowns.get(from.model_id);
      const recalled = memoryOn ? recall(s) : 0;
      handoffs.push({
        from_model: from.label, to_model: PROFILES[cands[0]].label, reason: until && until > Date.now() ? "429" : "manual",
        retry_after: until ? Math.ceil((until - Date.now()) / 1000) : null, memories_recalled: recalled, at: now(),
      });
      s.active = cands[0];
      s.spoke.delete(PROFILES[s.active].model_id);
    }
    const model = PROFILES[s.active];
    if (!memoryOn)
      alerts.push({ level: "info", code: "empty_contract", message: "Memory is OFF: no contract was sent, so this model sees only its own chat." });
    if (text.trim().length < 3)
      alerts.push({ level: "amber", code: "extraction_failed", message: "Couldn't extract anything from this turn. The raw turn is saved." });

    const { final, earlier } = reply(s, model, text, memoryOn, "first");
    s.spoke.add(model.model_id);
    for (const t of s.turns) t.can_rerun = false;
    const view: TurnView = {
      session_id: s.view.session_id, turn, user_text: text, reply: final, earlier_attempts: earlier, handoffs,
      alerts, fallback_contract: null, can_rerun: true, rerun_memory_on: !memoryOn,
    };
    s.turns.push(view);
    s.view = { ...s.view, turns: s.turns.length, active_model: model.model_id };
    extract(s, turn, text, model.label);
    return view;
  }

  const api: BatonApi = {
    async health() {
      return { ok: true, ai: "fake", models: PROFILES.map((p) => p.model_id) };
    },
    async projects() {
      return ["demo", ...[...new Set([...sessions.values()].map((s) => s.view.project))].filter((p) => p !== "demo")];
    },
    async startSession({ project, user, memory_on = true }) {
      if (!project.trim() || !user.trim()) throw new ApiError(422, "project and user are required");
      const sid = `sess-${Math.random().toString(36).slice(2, 10)}`;
      const s: MockSession = {
        view: {
          session_id: sid, project, user, memory_on, prefs: { no_bullets: false, free_text: [] }, turns: 0,
          active_model: PROFILES[0].model_id, created_at: now(),
        },
        turns: [], lines: [], ledger: [], traces: [], fetchedAt: null, benched: new Set(), active: 0,
        spoke: new Set(), pending: [], userTexts: [],
      };
      sessions.set(sid, s);
      recall(s);
      return s.view;
    },
    async session(sid) {
      return get(sid).view;
    },
    async updateSession(sid, body) {
      const s = get(sid);
      s.view = {
        ...s.view,
        memory_on: body.memory_on ?? s.view.memory_on,
        prefs: body.prefs ?? s.view.prefs,
      };
      return s.view;
    },
    async turns(sid) {
      return get(sid).turns;
    },
    async send(sid, text) {
      const s = get(sid);
      if (!text.trim()) throw new ApiError(422, "text is required");
      await sleep(latency);
      s.userTexts.push(text);
      return runTurn(s, text, s.view.memory_on);
    },
    async rerun(sid) {
      const s = get(sid);
      const last = s.turns.at(-1);
      if (!last || !last.reply || !last.can_rerun) throw new ApiError(422, "only the last answered turn can be re-run");
      await sleep(latency);
      const memoryOn = !last.reply.memory_on;
      const model = PROFILES.find((p) => p.model_id === last.reply!.model_id) ?? PROFILES[s.active];
      s.spoke.delete(model.model_id);
      const { final, earlier } = reply(s, model, last.user_text, memoryOn, "rerun");
      s.spoke.add(model.model_id);
      const view: TurnView = {
        ...last,
        reply: final,
        earlier_attempts: [...last.earlier_attempts, last.reply, ...earlier],
        alerts: memoryOn ? last.alerts.filter((a) => a.code !== "empty_contract") : last.alerts,
        can_rerun: true,
        rerun_memory_on: !memoryOn,
      };
      s.turns[s.turns.length - 1] = view;
      extract(s, last.turn, last.user_text, model.label);
      return view;
    },
    async models(sid) {
      return statuses(get(sid));
    },
    async switchModel(sid) {
      const s = get(sid);
      const from = PROFILES[s.active];
      s.benched.add(from.model_id);
      const next = candidates(s)[0];
      if (next !== undefined) {
        s.active = next;
        s.spoke.delete(PROFILES[next].model_id);
        s.pending.push({
          from_model: from.label, to_model: PROFILES[next].label, reason: "manual", retry_after: null,
          memories_recalled: s.view.memory_on ? recall(s) : 0, at: now(),
        });
      }
      return statuses(s);
    },
    async useModel(sid, modelId) {
      const s = get(sid);
      const i = PROFILES.findIndex((p) => p.model_id === modelId);
      if (i < 0) throw new ApiError(422, `unknown model ${modelId}`);
      s.benched.delete(modelId);
      if (i !== s.active) {
        s.active = i;
        s.spoke.delete(modelId);
      }
      return statuses(s);
    },
    async burst(modelId) {
      const p = PROFILES.find((x) => x.model_id === modelId);
      if (!p || !p.burstable) throw new ApiError(422, "only Groq models can burst");
      await sleep(latency * 1.6);
      const retry = 23;
      cooldowns.set(modelId, Date.now() + retry * 1000);
      return {
        result: { model_id: modelId, requests: 4, tokens_sent: 10_240, got_429: true, retry_after: retry },
        alerts: [],
      } satisfies BurstView;
    },
    async contract(sid) {
      return contractView(get(sid));
    },
    async ledger(sid) {
      return get(sid).ledger;
    },
    async reverse(sid, { item_id, reason }) {
      const s = get(sid);
      const row = s.ledger.find((r) => r.item_id === item_id);
      if (!row) throw new ApiError(404, `unknown item ${item_id}`);
      s.ledger = s.ledger.map((r) =>
        r.item_id === item_id ? { ...r, status: "reversed", reversal_reason: reason ?? "Reversed by the user" } : r,
      );
      return s.ledger;
    },
    async trace(sid) {
      const s = get(sid);
      const strip = ({ kind: _k, ...rest }: Line): ContractLine => rest;
      return {
        traces: s.traces, l1_items: s.lines.map(strip), l2_items: L2_LINES.map(strip), fetched_at: s.fetchedAt, alerts: [],
      } satisfies TraceView;
    },
    async refreshMemory(sid) {
      const s = get(sid);
      await sleep(latency / 2);
      recall(s);
      return api.trace(sid);
    },
  };
  return api;
}
