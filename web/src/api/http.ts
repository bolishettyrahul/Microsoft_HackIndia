// Typed client for the backend -> frontend contract (see contract.ts). One function per endpoint.
import type {
  BurstView, ContractView, Health, LedgerRow, ModelStatus, ReverseRejection, SessionView,
  StartSession, TraceView, TurnView, UpdateSession,
} from "./contract";
import type { BridgeSetup, BridgeView, ImportExchange } from "./bridge";

export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;
  constructor(status: number, detail: unknown) {
    super(typeof detail === "string" ? detail : `HTTP ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

/** Every call the UI makes. The HTTP client and the in-browser mock both implement it. */
export interface BatonApi {
  health(): Promise<Health>;
  projects(): Promise<string[]>;
  startSession(body: StartSession): Promise<SessionView>;
  session(sid: string): Promise<SessionView>;
  updateSession(sid: string, body: UpdateSession): Promise<SessionView>;
  turns(sid: string): Promise<TurnView[]>;
  send(sid: string, text: string): Promise<TurnView>;
  rerun(sid: string): Promise<TurnView>;
  models(sid: string): Promise<ModelStatus[]>;
  switchModel(sid: string): Promise<ModelStatus[]>;
  useModel(sid: string, modelId: string): Promise<ModelStatus[]>;
  burst(modelId: string): Promise<BurstView>;
  contract(sid: string): Promise<ContractView>;
  ledger(sid: string): Promise<LedgerRow[]>;
  reverse(sid: string, body: ReverseRejection): Promise<LedgerRow[]>;
  trace(sid: string): Promise<TraceView>;
  refreshMemory(sid: string): Promise<TraceView>;
  bridge(project: string): Promise<BridgeView>;
  bridgeSetup(): Promise<BridgeSetup>;
  importExchange(project: string, body: ImportExchange): Promise<BridgeView>;
}

type Fetch = typeof fetch;

export function createHttpApi(base = "/api", fetchImpl: Fetch = (...a) => fetch(...a)): BatonApi {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let detail: unknown = res.statusText;
      try {
        detail = ((await res.json()) as { detail?: unknown }).detail ?? detail;
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, detail);
    }
    return (await res.json()) as T;
  }
  const s = (sid: string) => `/sessions/${encodeURIComponent(sid)}`;
  const p = (project: string) => `/projects/${encodeURIComponent(project)}`;

  return {
    health: () => call("GET", "/health"),
    projects: () => call("GET", "/projects"),
    startSession: (body) => call("POST", "/sessions", body),
    session: (sid) => call("GET", s(sid)),
    updateSession: (sid, body) => call("PATCH", s(sid), body),
    turns: (sid) => call("GET", `${s(sid)}/turns`),
    send: (sid, text) => call("POST", `${s(sid)}/turns`, { text }),
    rerun: (sid) => call("POST", `${s(sid)}/rerun`),
    models: (sid) => call("GET", `${s(sid)}/models`),
    switchModel: (sid) => call("POST", `${s(sid)}/models/switch`),
    useModel: (sid, model_id) => call("POST", `${s(sid)}/models/use`, { model_id }),
    burst: (model_id) => call("POST", "/models/burst", { model_id }),
    contract: (sid) => call("GET", `${s(sid)}/contract`),
    ledger: (sid) => call("GET", `${s(sid)}/ledger`),
    reverse: (sid, body) => call("POST", `${s(sid)}/ledger/reverse`, body),
    trace: (sid) => call("GET", `${s(sid)}/trace`),
    refreshMemory: (sid) => call("POST", `${s(sid)}/memory/refresh`),
    bridge: (project) => call("GET", `${p(project)}/bridge`),
    bridgeSetup: () => call("GET", "/bridge/setup"),
    importExchange: (project, body) => call("POST", `${p(project)}/import`, body),
  };
}
