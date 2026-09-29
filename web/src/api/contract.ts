// The backend -> frontend contract. Mirrors baton/interfaces/api.py exactly.
// Owned by main: change it only there, together with api.py.
// Datetimes arrive as ISO 8601 strings (UTC).

export type CheckId =
  | "rejected" | "continuity" | "no_bullets" | "max_words"
  | "no_emojis" | "no_preamble" | "code_language";
export type BridgeApp = "chatgpt" | "claude" | "baton";
export type AlertLevel = "info" | "amber" | "red";
export type AlertCode =
  | "repair_skipped" | "extraction_failed" | "reversal_unmatched"
  | "ltm_unavailable" | "ltm_no_credits" | "empty_contract"
  | "model_unavailable" | "no_model";
export type ModelState = "ready" | "cooling" | "benched" | "disabled";
export type HandoffReason = "429" | "manual" | "auth" | "bad_request" | "error";

export interface Alert { level: AlertLevel; code: AlertCode; message: string }

export interface Preferences {
  no_bullets: boolean;
  max_words?: number | null;
  no_emojis?: boolean;
  no_preamble?: boolean;
  code_languages?: string[] | null;
  free_text: string[];
}

export interface PatchStat {
  model: string;
  check_id: CheckId;
  level: number;
  passes: number;
  trials: number;
}

export interface BridgeEvent {
  at: string;
  project: string;
  app: BridgeApp;
  action: "pull" | "record" | "check" | "import";
  summary: string;
  items: number;
  passed: boolean | null;
}

export interface HandoffEvent {
  from_model: string;
  to_model: string | null;
  reason: HandoffReason;
  retry_after: number | null;
  memories_recalled: number;
  at: string;
}

export interface RecallTrace {
  purpose: "state" | "ledger";
  query: string;
  tags: string[];
  result_count: number;
  latency_ms: number;
  error: string | null;
}

export interface ModelStatus {
  model_id: string;
  label: string;
  provider: string;
  state: ModelState;
  cooldown_until: string | null;
  is_active: boolean;
  burstable: boolean;
  detail: string | null;
}

export interface BurstResult {
  model_id: string;
  requests: number;
  tokens_sent: number;
  got_429: boolean;
  retry_after: number | null;
}

// ---------------------------------------------------------------- request bodies

export interface StartSession { project: string; user: string; memory_on?: boolean }
export interface UpdateSession { memory_on?: boolean | null; prefs?: Preferences | null }
export interface SendMessage { text: string }
export interface UseModel { model_id: string }
export interface ReverseRejection { item_id: string; reason?: string | null }
export interface ImportExchange {
  app?: "chatgpt" | "claude";
  user_message: string;
  assistant_reply: string;
}
export interface AskWhy { item_id: string }

// ---------------------------------------------------------------- views

export interface Health { ok: boolean; ai: "real" | "fake"; models: string[] }

export interface SessionView {
  session_id: string;
  project: string;
  user: string;
  memory_on: boolean;
  prefs: Preferences;
  turns: number;
  active_model: string | null;
  created_at: string;
}

export interface ChipView { check_id: CheckId; passed: boolean; label: string; evidence: string }

export interface ReplyView {
  message_id: number;
  model_id: string;
  model_label: string;
  text: string;
  memory_on: boolean;
  attempt: "first" | "repair" | "rerun";
  chips: ChipView[];
}

export interface TurnView {
  session_id: string;
  turn: number;
  user_text: string;
  reply: ReplyView | null;
  earlier_attempts: ReplyView[];
  handoffs: HandoffEvent[];
  alerts: Alert[];
  fallback_contract: string | null;
  can_rerun: boolean;
  rerun_memory_on: boolean | null;
}

export interface ContractLine {
  item_id: string;
  text: string;
  reason: string | null;
  turn: number;
  model: string | null;
  user: string;
  tier: "l1" | "l2";
}

export interface ContractView {
  project: string;
  goal: ContractLine | null;
  next_step: ContractLine | null;
  decisions: ContractLine[];
  constraints: ContractLine[];
  rejections: ContractLine[];
  open_questions: ContractLine[];
  preferences: Preferences;
  rendered: string;
  alerts: Alert[];
}

export interface LedgerRow {
  item_id: string;
  approach: string;
  reason: string | null;
  aliases: string[];
  turn: number;
  model: string | null;
  user: string;
  status: "active" | "reversed";
  reversal_reason: string | null;
}

export interface TraceView {
  traces: RecallTrace[];
  l1_items: ContractLine[];
  l2_items: ContractLine[];
  fetched_at: string | null;
  alerts: Alert[];
}

export interface BurstView { result: BurstResult; alerts: Alert[] }

export interface AppStatus {
  app: "chatgpt" | "claude";
  connected: boolean;
  last_seen: string | null;
  pulls: number;
  records: number;
  checks: number;
}

export interface BridgeView {
  project: string;
  apps: AppStatus[];
  events: BridgeEvent[];
  contract: ContractView;
  ledger: LedgerRow[];
}

export interface BridgeSetup {
  claude_desktop_config: string;
  claude_url: string;
  chatgpt_url: string | null;
  public_claude_url: string | null;
}

export interface LearningPoint {
  model: string;
  session_id: string;
  at: string;
  checks: number;
  failures: number;
}

export interface LearningView {
  stats: PatchStat[];
  points: LearningPoint[];
  alerts: Alert[];
}

export interface WhyView {
  item_id: string;
  approach: string;
  answer: string | null;
  sources: string[];
  error: string | null;
}

// ---------------------------------------------------------------- endpoints (all under /api)
//
//  GET    /health                                    -> Health
//  GET    /projects                                  -> string[]
//  POST   /sessions                StartSession      -> SessionView
//  GET    /sessions/{sid}                            -> SessionView
//  PATCH  /sessions/{sid}          UpdateSession     -> SessionView
//  GET    /sessions/{sid}/turns                      -> TurnView[]
//  POST   /sessions/{sid}/turns    SendMessage       -> TurnView
//  POST   /sessions/{sid}/rerun                      -> TurnView
//  GET    /sessions/{sid}/models                     -> ModelStatus[]
//  POST   /sessions/{sid}/models/switch              -> ModelStatus[]
//  POST   /sessions/{sid}/models/use   UseModel      -> ModelStatus[]
//  POST   /models/burst                UseModel      -> BurstView
//  GET    /sessions/{sid}/contract                   -> ContractView
//  GET    /sessions/{sid}/ledger                     -> LedgerRow[]
//  POST   /sessions/{sid}/ledger/reverse  ReverseRejection -> LedgerRow[]
//  GET    /sessions/{sid}/trace                      -> TraceView
//  POST   /sessions/{sid}/memory/refresh             -> TraceView
//  GET    /projects/{project}/bridge                 -> BridgeView
//  GET    /bridge/setup                              -> BridgeSetup
//  POST   /projects/{project}/import ImportExchange  -> BridgeView
//  GET    /projects/{project}/learning               -> LearningView
//  POST   /sessions/{sid}/ledger/why AskWhy          -> WhyView
//
// 404 for an unknown session or item; 422 for invalid input. Failures of models,
// memory or extraction never become HTTP errors: they arrive in `alerts`.
