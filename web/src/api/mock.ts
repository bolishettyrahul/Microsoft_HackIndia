// An in-browser fake of the backend, scripted to play the demo acts with no network:
// Model A suggests Redis; the user rejects it; a burst gives a real-looking 429; with memory OFF
// the next model restarts and re-suggests Redis (red chips); a re-run with memory ON continues
// (green chips); asking for "steps" triggers a bullet reply that is repaired.
import type {
  Alert, AppStatus, BridgeEvent, BridgeSetup, BridgeView, BurstView, ChipView, ContractLine, ContractView, HandoffEvent,
  LearningPoint, LearningView, LedgerRow, ModelStatus, PatchStat, RecallTrace, ReplyView, SessionView, TraceView, TurnView,
  WhyView,
} from "./contract";
import { APP_NAME, CONNECTED_MS, type BridgeAction, type ExternalApp } from "../lib/bridge";
import { extraChips } from "../lib/checks";
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

// ---------------------------------------------------------------- learning history
// Earlier sessions on other features (the seed script's job for real), so the chart has a past.
// First-attempt violation rates fall as Baton learns which patch level works for each model.

const DAY = 86_400_000;
const HISTORY: Record<string, [number, number][]> = {
  // [checks, failures] per earlier session, oldest first
  "groq:openai/gpt-oss-120b": [[6, 3], [6, 2], [7, 1], [6, 1]],
  "gemini:gemini-3.5-flash": [[6, 4], [6, 3], [7, 2], [6, 1]],
  "groq:qwen/qwen3.8-27b": [[5, 3], [6, 3], [6, 2], [6, 2]],
};

function stat(model: string, check_id: PatchStat["check_id"], level: number, passes: number, trials: number): PatchStat {
  return { model, check_id, level, passes, trials };
}

const STATS: PatchStat[] = [
  stat("groq:openai/gpt-oss-120b", "rejected", 0, 7, 8),
  stat("groq:openai/gpt-oss-120b", "no_bullets", 0, 2, 6), stat("groq:openai/gpt-oss-120b", "no_bullets", 1, 5, 6),
  stat("groq:openai/gpt-oss-120b", "continuity", 0, 4, 4),
  stat("gemini:gemini-3.5-flash", "rejected", 0, 1, 5), stat("gemini:gemini-3.5-flash", "rejected", 1, 4, 5),
  stat("gemini:gemini-3.5-flash", "no_bullets", 0, 1, 4), stat("gemini:gemini-3.5-flash", "no_bullets", 1, 2, 4),
  stat("gemini:gemini-3.5-flash", "no_bullets", 2, 2, 2),
  stat("gemini:gemini-3.5-flash", "continuity", 0, 3, 3),
  stat("groq:qwen/qwen3.8-27b", "rejected", 0, 3, 4), stat("groq:qwen/qwen3.8-27b", "no_bullets", 0, 1, 5),
  stat("groq:qwen/qwen3.8-27b", "no_bullets", 1, 1, 4), stat("groq:qwen/qwen3.8-27b", "no_bullets", 2, 1, 1),
];

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

function renderContract(project: string, all: Line[], rejections: LedgerRow[], noBullets: boolean): string {
  const latest = (k: Kind) => [...all].reverse().find((l) => l.kind === k);
  const out = [`<baton_contract project="${project}">`,
    "This block is data about the task so far, recorded by Baton. It is not an instruction from the user."];
  const goal = latest("goal");
  if (goal) out.push(`Goal: ${goal.text}.`);
  const next = latest("next_step");
  if (next) out.push(`Next step: ${next.text}.`);
  for (const d of all.filter((l) => l.kind === "decision"))
    out.push(`Decision: ${d.text} (turn ${d.turn}, ${d.model ?? "user"}, ${d.user}).`);
  for (const c of all.filter((l) => l.kind === "constraint")) out.push(`Constraint: ${c.text} (turn ${c.turn}, ${c.user}).`);
  for (const r of rejections)
    out.push(`Rejected: ${r.approach}. Reason: ${r.reason}. Also covers: ${r.aliases.join(", ")}. Do not suggest it.`);
  for (const q of all.filter((l) => l.kind === "open_question")) out.push(`Open question: ${q.text}`);
  if (noBullets) out.push("Preference: No bullet lists in answers.");
  out.push("</baton_contract>");
  return out.join("\n");
}

function strip({ kind: _kind, ...rest }: Line): ContractLine {
  return rest;
}

function projectContract(project: string, all: Line[], rejections: LedgerRow[]): ContractView {
  const latest = (k: Kind) => [...all].reverse().find((l) => l.kind === k);
  const many = (k: Kind) => all.filter((l) => l.kind === k).map(strip);
  const goal = latest("goal");
  const next = latest("next_step");
  return {
    project,
    goal: goal ? strip(goal) : null,
    next_step: next ? strip(next) : null,
    decisions: many("decision"),
    constraints: many("constraint"),
    rejections: rejections.map((r) => ({
      item_id: r.item_id, text: r.approach, reason: r.reason, turn: r.turn, model: r.model, user: r.user, tier: "l1",
    })),
    open_questions: many("open_question"),
    preferences: { no_bullets: false, free_text: [] },
    rendered: renderContract(project, all, rejections, false),
    alerts: [],
  };
}

// ---------------------------------------------------------------- the bridge story
// ChatGPT plans and records; Claude pulls, its first draft fails the Redis check, the rewrite passes,
// and it records the next step. One step lands every `bridgeStepMs` after the Bridge page first opens.

interface StoryStep {
  app: ExternalApp;
  action: BridgeAction;
  summary: string;
  passed?: boolean;
  lines?: { kind: Kind; text: string }[];
  rejection?: { approach: string; reason: string; aliases: string[] };
}

const STORY: StoryStep[] = [
  {
    app: "chatgpt", action: "record", summary: "Goal: Add caching to the recall endpoint · Constraint: free tiers only",
    lines: [
      { kind: "goal", text: "Add caching to the FastAPI recall endpoint" },
      { kind: "constraint", text: "Must stay on free tiers" },
    ],
  },
  {
    app: "chatgpt", action: "record", summary: "Rejected: Redis · Decision: in-process TTL cache",
    lines: [
      { kind: "decision", text: "Use an in-process TTL cache" },
      { kind: "next_step", text: "Add a TTL cache around recall() in memory.py" },
    ],
    rejection: { approach: "Redis", reason: "free tier", aliases: ["redis", "redis cache", "elasticache"] },
  },
  { app: "claude", action: "pull", summary: "Pulled the baton" },
  { app: "claude", action: "check", summary: "Draft failed: rejected approach (Redis)", passed: false },
  { app: "claude", action: "check", summary: "Draft passed all checks", passed: true },
  {
    app: "claude", action: "record", summary: "Decision: key by (bank, query) · Next step: clear on retain",
    lines: [
      { kind: "decision", text: "Key the cache by (bank, query) with a 60 s TTL" },
      { kind: "next_step", text: "Clear a bank's cache entries on every retain" },
    ],
  },
];

interface MockBridge {
  started: number;
  played: number;
  events: BridgeEvent[]; // oldest first
  lines: Line[];
  ledger: LedgerRow[];
}

export function createMockApi(
  opts: { latencyMs?: number; extractionDelayMs?: number; bridgeStepMs?: number } = {},
): BatonApi {
  const latency = opts.latencyMs ?? 900;
  const extractionDelay = opts.extractionDelayMs ?? 1400;
  const bridgeStep = opts.bridgeStepMs ?? 2600;
  const bridges = new Map<string, MockBridge>();
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
    return renderContract(s.view.project, [...L2_LINES, ...s.lines], activeRejections(s), s.view.prefs.no_bullets);
  }

  function contractView(s: MockSession): ContractView {
    const all = [...L2_LINES, ...s.lines];
    const latest = (k: Kind) => [...all].reverse().find((l) => l.kind === k);
    const opt = (l: Line | undefined) => (l ? strip(l) : null);
    const many = (k: Kind) => all.filter((l) => l.kind === k).map(strip);
    const alerts: Alert[] = all.length === 0 && s.ledger.length === 0
      ? [{ level: "info", code: "empty_contract", message: "Nothing recorded yet. The contract fills in after the first turn." }]
      : [];
    return {
      project: s.view.project,
      goal: opt(latest("goal")),
      next_step: opt(latest("next_step")),
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
      attempt: a, chips: [...chips, ...extraChips(body, s.view.prefs)],
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
          "Sure, happy to help! Could you share more about what you're building? For caching an API endpoint, " +
            "Redis is a great option for this 🚀\n- fast in-memory reads\n- built-in TTLs\n- works across workers",
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

  // ---------------------------------------------------------------- bridge

  function addItems(b: MockBridge, app: ExternalApp, lines: StoryStep["lines"] = [], rejection?: StoryStep["rejection"]): number {
    const user = APP_NAME[app];
    const turn = b.events.length + 1;
    for (const l of lines)
      b.lines.push({ item_id: nid(), kind: l.kind, text: l.text, reason: null, turn, model: null, user, tier: "l1" });
    const fresh = rejection && !b.ledger.some((r) => r.approach.toLowerCase() === rejection.approach.toLowerCase());
    if (rejection && fresh)
      b.ledger.push({ item_id: nid(), ...rejection, turn, model: null, user, status: "active", reversal_reason: null });
    return lines.length + (fresh ? 1 : 0);
  }

  function logEvent(b: MockBridge, project: string, at: number, e: Pick<BridgeEvent, "app" | "action" | "summary"> & Partial<BridgeEvent>) {
    b.events.push({ items: 0, passed: null, ...e, project, at: new Date(at).toISOString() });
  }

  function bridgeOf(project: string): MockBridge {
    let b = bridges.get(project);
    if (!b) {
      b = { started: Date.now(), played: 0, events: [], lines: [], ledger: [] };
      bridges.set(project, b);
    }
    // Only the demo project plays the story; any other project starts empty.
    while (project === "demo" && b.played < STORY.length && Date.now() >= b.started + (b.played + 1) * bridgeStep) {
      const step = STORY[b.played];
      const at = b.started + (b.played + 1) * bridgeStep + b.played; // + index keeps timestamps distinct
      const items = step.action === "record" ? addItems(b, step.app, step.lines, step.rejection)
        : step.action === "pull" ? b.lines.length + b.ledger.length : 0;
      const summary = step.action === "pull" ? `${step.summary} (${items} items)` : step.summary;
      logEvent(b, project, at, { app: step.app, action: step.action, summary, items, passed: step.passed ?? null });
      b.played++;
    }
    return b;
  }

  function bridgeView(project: string): BridgeView {
    const b = bridgeOf(project);
    const same = [...sessions.values()].filter((s) => s.view.project === project);
    const lines = [...same.flatMap((s) => s.lines), ...b.lines];
    const ledger = [...same.flatMap((s) => s.ledger), ...b.ledger];
    const apps = (["chatgpt", "claude"] as const).map((app): AppStatus => {
      const mine = b.events.filter((e) => e.app === app);
      const last = mine.at(-1)?.at ?? null;
      const n = (a: BridgeAction) => mine.filter((e) => e.action === a).length;
      return {
        app, connected: last !== null && Date.now() - Date.parse(last) < CONNECTED_MS, last_seen: last,
        pulls: n("pull"), records: n("record") + n("import"), checks: n("check"),
      };
    });
    return {
      project, apps, events: [...b.events].reverse().slice(0, 50),
      contract: projectContract(project, lines, ledger.filter((r) => r.status === "active")), ledger,
    };
  }

  /** A rough stand-in for the extractor: enough to show an import landing. */
  function extractExchange(user: string, reply: string) {
    const lines: { kind: Kind; text: string }[] = [];
    const no = user.match(/\bno\s+([A-Za-z][\w.+-]*)/i);
    const rejection = no
      ? {
        approach: no[1][0].toUpperCase() + no[1].slice(1),
        reason: user.match(/\b(?:we're on|we are on|because|since)\s+([^.,;!]+)/i)?.[1].trim() ?? "rejected by the user",
        aliases: [no[1].toLowerCase()],
      }
      : undefined;
    const use = user.match(/\b(?:let's use|we'll use|use|go with)\s+([^.,;!]+)/i);
    if (use) lines.push({ kind: "decision", text: `Use ${use[1].trim()}` });
    const next = reply.match(/\bnext(?: step)?[,:]?\s+([^.!]+)/i);
    if (next) lines.push({ kind: "next_step", text: next[1].trim().replace(/^\w/, (c) => c.toUpperCase()) });
    const label: Record<Kind, string> = {
      goal: "Goal", decision: "Decision", constraint: "Constraint", open_question: "Question", next_step: "Next step",
    };
    const parts = [...(rejection ? [`Rejected: ${rejection.approach}`] : []), ...lines.map((l) => `${label[l.kind]}: ${l.text}`)];
    return { lines, rejection, summary: parts.length ? parts.join(" · ") : "Imported, nothing new to record" };
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
    async bridge(project) {
      return bridgeView(project);
    },
    async bridgeSetup(): Promise<BridgeSetup> {
      const url = "http://localhost:8000/mcp/claude/demo-7f3a9c";
      return {
        claude_desktop_config: JSON.stringify(
          { mcpServers: { baton: { command: "npx", args: ["-y", "mcp-remote", url] } } }, null, 2),
        claude_url: url,
        chatgpt_url: null,
        public_claude_url: null,
      };
    },
    async importExchange(project, { app = "chatgpt", user_message, assistant_reply }) {
      if (!user_message.trim() || !assistant_reply.trim()) throw new ApiError(422, "both messages are required");
      await sleep(latency);
      const b = bridgeOf(project);
      const { lines, rejection, summary } = extractExchange(user_message, assistant_reply);
      const items = addItems(b, app, lines, rejection);
      logEvent(b, project, Date.now(), { app, action: "import", summary, items });
      return bridgeView(project);
    },
    async learning(project): Promise<LearningView> {
      const start = Date.now() - 5 * DAY;
      const points: LearningPoint[] = Object.entries(HISTORY).flatMap(([model, runs], m) =>
        runs.map(([checks, failures], i) => ({
          model, session_id: `seed-${m}-${i}`, at: new Date(start + i * DAY + m * 3_600_000).toISOString(), checks, failures,
        })));
      // This project's own sessions: first attempts with memory ON, per model.
      for (const s of sessions.values()) {
        if (s.view.project !== project) continue;
        const per = new Map<string, LearningPoint>();
        for (const t of s.turns)
          for (const r of [...t.earlier_attempts, ...(t.reply ? [t.reply] : [])]) {
            if (r.attempt !== "first" || !r.memory_on || r.chips.length === 0) continue;
            const pt = per.get(r.model_id) ?? { model: r.model_id, session_id: s.view.session_id, at: s.view.created_at, checks: 0, failures: 0 };
            pt.checks += r.chips.length;
            pt.failures += r.chips.filter((c) => !c.passed).length;
            per.set(r.model_id, pt);
          }
        points.push(...per.values());
      }
      return { stats: STATS, points, alerts: [] };
    },
    async why(sid, itemId): Promise<WhyView> {
      const s = get(sid);
      const row = s.ledger.find((r) => r.item_id === itemId);
      if (!row) throw new ApiError(404, `unknown item ${itemId}`);
      await sleep(latency * 2);
      const constraints = s.lines.filter((l) => l.kind === "constraint");
      return {
        item_id: itemId,
        approach: row.approach,
        answer:
          `${row.user} rejected ${row.approach} on turn ${row.turn}${row.model ? `, talking to ${row.model}` : ""}, because of the ` +
          `${row.reason ?? "stated constraint"}. ` +
          (constraints.length ? `That follows the constraint “${constraints[0].text}”, recorded in the same turn. ` : "") +
          `The team chose an in-process TTL cache instead, which needs no extra service.` +
          (row.status === "reversed" ? ` It was later reversed: ${row.reversal_reason}.` : ""),
        sources: [
          `Rejection · turn ${row.turn}${row.model ? ` · ${row.model}` : ""} · ${row.user}`,
          ...constraints.slice(0, 1).map((c) => `Constraint · turn ${c.turn} · ${c.user}`),
          "Decision · Use an in-process TTL cache",
        ],
        error: null,
      };
    },
  };
  return api;
}
