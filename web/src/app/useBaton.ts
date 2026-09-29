import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import type {
  BurstView, ContractView, LedgerRow, ModelStatus, SessionView, TraceView, TurnView,
} from "../api/contract";

const SID_KEY = "baton.sid";
const POLL_MS = 2000;
const POLL_WINDOW_MS = 10_000; // extraction runs in the background after each reply

export type Busy = null | "start" | "send" | "rerun" | "switch" | "refresh" | `burst:${string}` | `use:${string}`;

function message(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function useBaton() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [turns, setTurns] = useState<TurnView[]>([]);
  const [models, setModels] = useState<ModelStatus[]>([]);
  const [contract, setContract] = useState<ContractView | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [trace, setTrace] = useState<TraceView | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [burst, setBurst] = useState<BurstView | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pollUntil = useRef(0);
  const inFlight = useRef(false);
  const sid = session?.session_id ?? null;

  const refreshSide = useCallback(async (id: string) => {
    const [c, l, t, m, s] = await Promise.all([
      api.contract(id), api.ledger(id), api.trace(id), api.models(id), api.session(id),
    ]);
    setContract(c);
    setLedger(l);
    setTrace(t);
    setModels(m);
    setSession(s);
  }, []);

  const load = useCallback(async (id: string) => {
    const [s, ts] = await Promise.all([api.session(id), api.turns(id)]);
    setSession(s);
    setTurns(ts);
    await refreshSide(id);
  }, [refreshSide]);

  // Restore the last session after a reload (HTTP mode; the mock forgets on reload).
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(SID_KEY);
    } catch {
      /* storage blocked */
    }
    if (saved) load(saved).catch(() => sessionStorage.removeItem(SID_KEY));
  }, [load]);

  // One heartbeat: tick countdowns every second; refresh side panels while extraction may be running,
  // and models while any is cooling.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!sid) return;
    const t = setInterval(() => {
      if (Date.now() < pollUntil.current) refreshSide(sid).catch(() => {});
      else if (models.some((m) => m.state === "cooling")) api.models(sid).then(setModels).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(t);
  }, [sid, refreshSide, models]);

  const run = useCallback(async <T,>(kind: Busy, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(kind);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(message(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);

  const start = useCallback((project: string, user: string, memoryOn = true) =>
    run("start", async () => {
      const s = await api.startSession({ project, user, memory_on: memoryOn });
      try {
        sessionStorage.setItem(SID_KEY, s.session_id);
      } catch {
        /* storage blocked */
      }
      setSession(s);
      setTurns([]);
      setBurst(null);
      await refreshSide(s.session_id);
    }), [run, refreshSide]);

  const send = useCallback(async (text: string) => {
    if (!sid || inFlight.current) return; // guard double submits
    inFlight.current = true;
    const optimistic: TurnView = {
      session_id: sid, turn: turns.length + 1, user_text: text, reply: null, earlier_attempts: [], handoffs: [],
      alerts: [], fallback_contract: null, can_rerun: false, rerun_memory_on: null,
    };
    setTurns((ts) => [...ts.map((t) => ({ ...t, can_rerun: false })), optimistic]);
    await run("send", async () => {
      try {
        const turn = await api.send(sid, text);
        setTurns((ts) => [...ts.slice(0, -1), turn]);
      } catch (e) {
        setTurns((ts) => ts.slice(0, -1));
        throw e;
      }
      pollUntil.current = Date.now() + POLL_WINDOW_MS;
      await refreshSide(sid);
    });
    inFlight.current = false;
  }, [sid, turns.length, run, refreshSide]);

  const rerun = useCallback(async () => {
    if (!sid || inFlight.current) return;
    inFlight.current = true;
    await run("rerun", async () => {
      const turn = await api.rerun(sid);
      setTurns((ts) => [...ts.slice(0, -1), turn]);
      pollUntil.current = Date.now() + POLL_WINDOW_MS;
      await refreshSide(sid);
    });
    inFlight.current = false;
  }, [sid, run, refreshSide]);

  const setMemory = useCallback((on: boolean) => sid && run(null, async () => {
    setSession(await api.updateSession(sid, { memory_on: on }));
  }), [sid, run]);

  const setNoBullets = useCallback((on: boolean) => sid && session && run(null, async () => {
    setSession(await api.updateSession(sid, { prefs: { ...session.prefs, no_bullets: on } }));
    setContract(await api.contract(sid));
  }), [sid, session, run]);

  const switchModel = useCallback(() => sid && run("switch", async () => setModels(await api.switchModel(sid))), [sid, run]);
  const pickModel = useCallback((id: string) => sid && run(`use:${id}`, async () => setModels(await api.useModel(sid, id))), [sid, run]);
  const exhaust = useCallback((id: string) => run(`burst:${id}`, async () => {
    setBurst(await api.burst(id));
    if (sid) setModels(await api.models(sid));
  }), [sid, run]);
  const reverse = useCallback((itemId: string, reason?: string) => sid && run(null, async () => {
    setLedger(await api.reverse(sid, { item_id: itemId, reason: reason || null }));
    setContract(await api.contract(sid));
  }), [sid, run]);
  const refreshMemory = useCallback(() => sid && run("refresh", async () => {
    setTrace(await api.refreshMemory(sid));
    setContract(await api.contract(sid));
  }), [sid, run]);

  const newSession = useCallback(() => {
    try {
      sessionStorage.removeItem(SID_KEY);
    } catch {
      /* storage blocked */
    }
    setSession(null);
    setTurns([]);
    setContract(null);
    setLedger([]);
    setTrace(null);
    setBurst(null);
  }, []);

  return {
    session, turns, models, contract, ledger, trace, busy, error, burst, now,
    start, send, rerun, setMemory, setNoBullets, switchModel, pickModel, exhaust, reverse, refreshMemory, newSession,
    dismissBurst: () => setBurst(null),
    dismissError: () => setError(null),
  };
}

export type BatonState = ReturnType<typeof useBaton>;
