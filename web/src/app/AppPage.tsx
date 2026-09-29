import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, X, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { api, apiMode } from "../api";
import { Aurora, Wordmark } from "../components/brand";
import { AlertBanner, Button, Glass, Toggle } from "../components/ui";
import { Chat } from "./Chat";
import { Sidebar } from "./Sidebar";
import { Tabs } from "./Tabs";
import { useBaton, type BatonState } from "./useBaton";

export function AppPage() {
  const b = useBaton();
  return (
    <div className="h-dvh overflow-hidden">
      <Aurora intensity={0.7} />
      {b.session ? <Workspace b={b} /> : <StartScreen b={b} />}
    </div>
  );
}

function Workspace({ b }: { b: BatonState }) {
  return (
    <div className="flex h-full flex-col gap-3 p-3 lg:grid lg:grid-cols-[280px_minmax(0,3fr)_minmax(0,2fr)]">
      <div className="hidden min-h-0 lg:block"><Sidebar b={b} /></div>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <Toasts b={b} />
        <div className="lg:hidden"><MobileBar b={b} /></div>
        <div className="min-h-0 flex-1"><Chat b={b} /></div>
      </div>
      <div className="hidden min-h-0 lg:block"><Tabs b={b} /></div>
    </div>
  );
}

function Toasts({ b }: { b: BatonState }) {
  return (
    <AnimatePresence>
      {b.burst && (
        <motion.div key="burst" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
          <div className="flex items-center gap-3 rounded-xl border border-cool/30 bg-cool/[0.08] px-4 py-2.5 text-[13px] text-amber-100">
            <Zap size={15} className="shrink-0 text-cool" />
            <span>
              Burst on <span className="font-mono">{b.burst.result.model_id}</span>: {b.burst.result.requests} real requests,{" "}
              {b.burst.result.tokens_sent.toLocaleString()} tokens.{" "}
              {b.burst.result.got_429
                ? <>Got a <b>429</b>. Cooling for {Math.round(b.burst.result.retry_after ?? 0)} s. The next message hands off.</>
                : "No 429 yet."}
            </span>
            <button onClick={b.dismissBurst} className="ml-auto text-cool/70 hover:text-cool" aria-label="Dismiss"><X size={14} /></button>
          </div>
          {b.burst.alerts.map((a, i) => <AlertBanner key={i} alert={a} className="mt-2" />)}
        </motion.div>
      )}
      {b.error && (
        <motion.div key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="flex items-center gap-3 rounded-xl border border-fail/35 bg-fail/[0.09] px-4 py-2.5 text-[13px] text-red-200" role="alert">
            {b.error}
            <button onClick={b.dismissError} className="ml-auto" aria-label="Dismiss"><X size={14} /></button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Small screens: the essentials of the sidebar in one row. */
function MobileBar({ b }: { b: BatonState }) {
  const active = b.models.find((m) => m.is_active);
  return (
    <Glass className="flex items-center gap-3 px-3 py-2">
      <Link to="/"><Wordmark /></Link>
      <span className="truncate font-mono text-[11px] text-muted">{active?.label}</span>
      <span className="ml-auto text-[12px] text-muted">Memory</span>
      <Toggle checked={b.session?.memory_on ?? true} onChange={(v) => b.setMemory(v)} label="Memory" />
      <Button size="sm" onClick={() => b.switchModel()}>Switch</Button>
    </Glass>
  );
}

function StartScreen({ b }: { b: BatonState }) {
  const [project, setProject] = useState("demo");
  const [user, setUser] = useState("Rahul");
  const [memoryOn, setMemoryOn] = useState(true);
  const [projects, setProjects] = useState<string[]>([]);
  const [health, setHealth] = useState<string>("checking…");

  useEffect(() => {
    api.projects().then(setProjects).catch(() => {});
    api.health()
      .then((h) => setHealth(h.ok ? `${h.ai === "real" ? "live models" : "fake models"} · ${h.models.length} in the chain` : "backend not ok"))
      .catch(() => setHealth("backend unreachable on :8000"));
  }, []);

  return (
    <div className="flex h-full items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="w-full max-w-md">
        <Glass className="p-8">
          <Link to="/"><Wordmark /></Link>
          <h1 className="mt-6 font-display text-5xl leading-[1.05]">Pick up <i className="baton-text pr-1">the baton.</i></h1>
          <p className="mt-3 text-[14px] text-muted">Teammates on the same project share one memory bank, so the next model, or the next person, continues where you stopped.</p>
          <form
            className="mt-7 flex flex-col gap-4"
            onSubmit={(e) => { e.preventDefault(); void b.start(project.trim(), user.trim(), memoryOn); }}
          >
            <label className="flex flex-col gap-1.5 text-[13px]">
              <span className="text-muted">Project</span>
              <input list="projects" value={project} onChange={(e) => setProject(e.target.value)} required
                className="h-11 rounded-xl border border-white/10 bg-black/30 px-3 font-mono text-[14px] outline-none focus:border-lane-b/50" />
              <datalist id="projects">{projects.map((p) => <option key={p} value={p} />)}</datalist>
            </label>
            <label className="flex flex-col gap-1.5 text-[13px]">
              <span className="text-muted">Your name</span>
              <input value={user} onChange={(e) => setUser(e.target.value)} required
                className="h-11 rounded-xl border border-white/10 bg-black/30 px-3 text-[14px] outline-none focus:border-lane-b/50" />
            </label>
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-[13px]">
              <span>Memory {memoryOn ? "ON" : "OFF"}</span>
              <Toggle checked={memoryOn} onChange={setMemoryOn} label="Memory" />
            </div>
            <Button variant="primary" type="submit" disabled={b.busy === "start"} className="h-11">
              {b.busy === "start" ? "Starting…" : "Start session"} <ArrowRight size={16} />
            </Button>
            {b.error && <div className="text-[13px] text-fail" role="alert">{b.error}</div>}
          </form>
          <div className="mt-6 flex items-center gap-2 font-mono text-[11px] text-faint">
            <span className={apiMode === "mock" ? "text-cool" : "text-pass"}>●</span>
            {apiMode === "mock" ? "demo mode (scripted backend)" : health}
          </div>
        </Glass>
      </motion.div>
    </div>
  );
}
