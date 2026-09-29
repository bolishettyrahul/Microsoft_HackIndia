// Contracts v2 (planv2 §0.4): the bridge between ChatGPT, Claude and Baton.
// These mirror baton/interfaces/api.py v2 exactly. They live here until main lands them in contract.ts;
// then this file should re-export from there.
import type { ContractLine, ContractView, LedgerRow } from "./contract";

export type BridgeApp = "chatgpt" | "claude" | "baton";
export type ExternalApp = "chatgpt" | "claude";
export type BridgeAction = "pull" | "record" | "check" | "import";

export interface BridgeEvent {
  at: string;
  project: string;
  app: BridgeApp;
  action: BridgeAction;
  summary: string;
  items: number;
  passed: boolean | null;
}

export interface AppStatus {
  app: ExternalApp;
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

export interface ImportExchange {
  app?: ExternalApp;
  user_message: string;
  assistant_reply: string;
}

//  GET  /projects/{project}/bridge                   -> BridgeView
//  GET  /bridge/setup                                -> BridgeSetup
//  POST /projects/{project}/import  ImportExchange   -> BridgeView

// ---------------------------------------------------------------- view logic (pure, tested)

export const CONNECTED_MS = 10 * 60 * 1000;

export const APP_NAME: Record<BridgeApp, string> = { chatgpt: "ChatGPT", claude: "Claude", baton: "Baton" };

/** Connected when seen in the last 10 minutes, judged against the client clock so the light goes grey on its own. */
export function isConnected(s: AppStatus | undefined, nowMs = Date.now()): boolean {
  if (!s?.last_seen) return false;
  return nowMs - Date.parse(s.last_seen) < CONNECTED_MS;
}

/** "just now", "12 s ago", "4 min ago", "2 h ago". */
export function ago(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

export const eventKey = (e: BridgeEvent) => `${e.at}|${e.app}|${e.action}|${e.summary}`;

/** Newest first. Stable for events with the same timestamp, so the timeline doesn't jitter between polls. */
export function sortEvents(events: readonly BridgeEvent[]): BridgeEvent[] {
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => Date.parse(b.e.at) - Date.parse(a.e.at) || a.i - b.i)
    .map(({ e }) => e);
}

/** Keys of passing checks that follow a failed check by the same app: the visible repair. */
export function repairedChecks(events: readonly BridgeEvent[]): Set<string> {
  const out = new Set<string>();
  const failing = new Set<BridgeApp>();
  for (const e of [...sortEvents(events)].reverse()) {
    if (e.action !== "check") continue;
    if (e.passed === false) failing.add(e.app);
    else if (e.passed && failing.has(e.app)) {
      out.add(eventKey(e));
      failing.delete(e.app);
    }
  }
  return out;
}

/** Which app recorded a contract line. External apps record under the user "ChatGPT" or "Claude". */
export function appOfLine(l: Pick<ContractLine, "user">): BridgeApp {
  const u = l.user.trim().toLowerCase();
  return u === "chatgpt" ? "chatgpt" : u === "claude" ? "claude" : "baton";
}

/**
 * Where the baton moves for a new event: a record or import carries it from the app into the middle;
 * a pull carries it from whoever last recorded to the app that pulled.
 */
export function relayMove(ev: BridgeEvent, history: readonly BridgeEvent[]): { from: BridgeApp; to: BridgeApp } | null {
  if (ev.action === "record" || ev.action === "import") return { from: ev.app, to: "baton" };
  if (ev.action === "pull") {
    const src = sortEvents(history).find(
      (e) => (e.action === "record" || e.action === "import") && Date.parse(e.at) <= Date.parse(ev.at) && e.app !== ev.app,
    );
    return { from: src?.app ?? "baton", to: ev.app };
  }
  return null;
}
