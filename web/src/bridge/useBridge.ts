import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import {
  eventKey, relayMove, sortEvents, type BridgeApp, type BridgeEvent, type BridgeSetup, type BridgeView, type ImportExchange,
} from "../api/bridge";

const POLL_MS = 2000;

export interface RelayMove { id: string; from: BridgeApp; to: BridgeApp }

function message(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Everything the Bridge page shows, for one project: polled every 2 s. */
export function useBridge(project: string) {
  const [view, setView] = useState<BridgeView | null>(null);
  const [setup, setSetup] = useState<BridgeSetup | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [move, setMove] = useState<RelayMove | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef<Set<string> | null>(null);

  // New events since the last poll: the newest one moves the baton. The first load animates nothing.
  const accept = useCallback((v: BridgeView) => {
    const keys = v.events.map(eventKey);
    if (seen.current) {
      const added = sortEvents(v.events).filter((e) => !seen.current!.has(eventKey(e)));
      if (added.length) {
        setFresh(new Set(added.map(eventKey)));
        const newest = added.find((e) => relayMove(e, v.events));
        const m = newest && relayMove(newest, v.events);
        if (m && newest) setMove({ id: eventKey(newest), ...m });
      }
    }
    seen.current = new Set(keys);
    setView(v);
  }, []);

  const refresh = useCallback(async () => {
    try {
      accept(await api.bridge(project));
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  }, [project, accept]);

  useEffect(() => {
    seen.current = null;
    setView(null);
    setMove(null);
    setFresh(new Set());
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    api.bridgeSetup().then(setSetup).catch(() => {});
    api.projects().then(setProjects).catch(() => {});
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  /** Import a pasted exchange. Returns the event it logged, for the toast. */
  const importExchange = useCallback(async (body: ImportExchange): Promise<BridgeEvent | null> => {
    setImporting(true);
    try {
      const v = await api.importExchange(project, body);
      accept(v);
      setError(null);
      return sortEvents(v.events).find((e) => e.action === "import") ?? null;
    } catch (e) {
      setError(message(e));
      return null;
    } finally {
      setImporting(false);
    }
  }, [project, accept]);

  return { view, setup, projects, error, move, fresh, importing, now, importExchange, refresh };
}

export type BridgeState = ReturnType<typeof useBridge>;
