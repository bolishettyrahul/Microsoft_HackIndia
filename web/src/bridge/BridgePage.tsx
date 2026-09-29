import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowDownToLine, ArrowRight, Ban, ClipboardPaste, PenLine, Settings2, ShieldCheck, ShieldX, X,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { apiMode } from "../api";
import type { AppStatus, BridgeApp, BridgeEvent } from "../api/contract";
import {
  APP_NAME, ago, appOfLine, eventKey, isConnected, repairedChecks, sortEvents, type BridgeAction, type ExternalApp,
} from "../lib/bridge";
import type { ContractLine, LedgerRow } from "../api/contract";
import { Aurora, BatonMark, Wordmark } from "../components/brand";
import { AlertBanner, Button, Tag, cx } from "../components/ui";
import { CopyButton } from "../app/Chat";
import { Field, Fold } from "../app/Tabs";
import { appLane } from "../lib/lanes";
import { AppIcon } from "./AppIcon";
import { ImportCard, SetupDrawer } from "./BridgePanels";
import { useBridge, type BridgeState, type RelayMove } from "./useBridge";

/** /bridge: ChatGPT and Claude lanes around the shared baton, with a live timeline of every pull, record and check. */
export function BridgePage() {
  const [params, setParams] = useSearchParams();
  const project = params.get("project")?.trim() || "demo";
  const br = useBridge(project);
  const [setupOpen, setSetupOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const status = (app: ExternalApp) => br.view?.apps.find((a) => a.app === app);
  const anyConnected = (["chatgpt", "claude"] as const).some((a) => isConnected(status(a), br.now));

  return (
    <div className="min-h-dvh">
      <Aurora intensity={0.3} />
      <div className="mx-auto flex max-w-[1480px] flex-col gap-3 p-3">
        <Header project={project} projects={br.projects} onProject={(p) => setParams({ project: p })} onSetup={() => setSetupOpen(true)} />
        {br.error && (
          <div role="alert" className="rounded-xl border border-fail/35 bg-fail/[0.09] px-4 py-2.5 text-[13px] text-red-200">
            Can't reach the bridge: {br.error}
          </div>
        )}
        {br.view && !anyConnected && br.view.events.length === 0 && (
          <div className="glass flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-[13.5px]">
            <span className="size-2 rounded-full bg-bench" />
            <span><b className="font-medium">No app connected yet.</b> <span className="text-muted">Connect Claude Desktop or ChatGPT, or paste a ChatGPT exchange below.</span></span>
            <Button size="sm" className="ml-auto" onClick={() => setSetupOpen(true)}><Settings2 size={13} /> Open setup</Button>
          </div>
        )}
        <RelayRail move={br.move} />
        <div className="grid gap-3 lg:grid-cols-[1fr_1.35fr_1fr]">
          <LaneColumn app="chatgpt" status={status("chatgpt")} br={br} onSetup={() => setSetupOpen(true)} />
          <BatonColumn br={br} />
          <LaneColumn app="claude" status={status("claude")} br={br} onSetup={() => setSetupOpen(true)} />
        </div>
        <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
          <Timeline br={br} />
          <ImportCard br={br} onDone={(e) => setToast(e ? `${e.items} item${e.items === 1 ? "" : "s"} recorded · ${e.summary}` : null)} />
        </div>
        <div className="py-2 text-center font-mono text-[11px] text-faint">
          {apiMode === "mock" ? "demo mode: a scripted bridge story plays on the demo project" : "live · polling every 2 s"}
        </div>
      </div>
      <SetupDrawer open={setupOpen} onClose={() => setSetupOpen(false)} setup={br.setup} project={project} />
      <AnimatePresence>
        {toast && (
          <motion.div role="status" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
            className="fixed bottom-4 left-1/2 z-50 flex w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-xl border border-pass/30 bg-ink-2 px-4 py-2.5 text-[13px] shadow-2xl shadow-black/60">
            <ClipboardPaste size={15} className="shrink-0 text-pass" />
            <span className="min-w-0 flex-1">{toast}</span>
            <button onClick={() => setToast(null)} aria-label="Dismiss" className="text-muted hover:text-fg"><X size={14} /></button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Header({ project, projects, onProject, onSetup }: {
  project: string; projects: string[]; onProject: (p: string) => void; onSetup: () => void;
}) {
  const [draft, setDraft] = useState(project);
  useEffect(() => setDraft(project), [project]);
  const commit = () => draft.trim() && draft.trim() !== project && onProject(draft.trim());
  return (
    <header className="glass relative z-30 flex flex-wrap items-center gap-3 rounded-2xl px-3 py-2 sm:px-4">
      <Link to="/" aria-label="Baton home" className="shrink-0"><Wordmark /></Link>
      <span className="hidden h-5 w-px bg-white/10 sm:block" />
      <span className="font-display text-[22px] leading-none">Bridge</span>
      <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); commit(); }}>
        <label htmlFor="bridge-project" className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">project</label>
        <input id="bridge-project" list="bridge-projects" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
          className="h-8 w-36 rounded-lg border border-white/10 bg-black/30 px-2.5 font-mono text-[13px] outline-none focus:border-lane-b/50" />
        <datalist id="bridge-projects">{projects.map((p) => <option key={p} value={p} />)}</datalist>
      </form>
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" onClick={onSetup}><Settings2 size={13} /> Setup</Button>
        <Link to="/app" className="inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-[13px] text-muted hover:bg-white/[0.05] hover:text-fg">
          In-app demo <ArrowRight size={13} />
        </Link>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- the relay rail

// Column centres for the 1fr / 1.35fr / 1fr grid below, so the nodes sit over their lanes.
const POS: Record<BridgeApp, string> = { chatgpt: "14.9%", baton: "50%", claude: "85.1%" };

function RelayRail({ move }: { move: RelayMove | null }) {
  const reduce = useReducedMotion();
  const rest = move?.to ?? "baton";
  return (
    <div className="glass relative h-14 overflow-hidden rounded-2xl" aria-hidden>
      <div className="absolute inset-x-[14.9%] top-1/2 h-[2px] -translate-y-1/2 rounded-full"
        style={{ background: `linear-gradient(90deg, ${appLane("chatgpt").color}, ${appLane("baton").color}, ${appLane("claude").color})`, opacity: 0.35 }} />
      {(["chatgpt", "baton", "claude"] as const).map((a) => (
        <span key={a} className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2" style={{ left: POS[a] }}>
          <span className="size-2.5 rounded-full" style={{ background: appLane(a).color, boxShadow: `0 0 10px ${appLane(a).color}` }} />
        </span>
      ))}
      <motion.div
        key={move?.id ?? "rest"}
        className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
        initial={{ left: reduce || !move ? POS[rest] : POS[move.from] }}
        animate={{ left: POS[rest] }}
        transition={{ duration: 1.1, ease: [0.65, 0, 0.35, 1] }}
      >
        <div className="rounded-full bg-ink/80 p-1.5 shadow-[0_0_24px_rgb(167_139_250/0.8)]"><BatonMark size={20} /></div>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------- lanes

function LaneColumn({ app, status, br, onSetup }: { app: ExternalApp; status: AppStatus | undefined; br: BridgeState; onSetup: () => void }) {
  const connected = isConnected(status, br.now);
  const events = sortEvents(br.view?.events ?? []).filter((e) => e.app === app).slice(0, 5);
  return (
    <section className="surface flex min-h-[320px] flex-col rounded-2xl p-4" aria-label={`${APP_NAME[app]} lane`}>
      <div className="flex items-center gap-3">
        <AppIcon app={app} size={38} />
        <div className="min-w-0">
          <div className="text-[16px] font-medium">{APP_NAME[app]}</div>
          <div className="flex items-center gap-1.5 text-[12px] text-muted">
            <span className={cx("size-2 rounded-full", connected ? "bg-pass shadow-[0_0_8px_var(--color-pass)]" : "bg-bench")}
              role="img" aria-label={connected ? "connected" : "idle"} />
            {connected ? "Connected" : status?.last_seen ? "Idle" : "Not connected yet"}
            <span className="text-faint">· last seen {ago(status?.last_seen, br.now)}</span>
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {([["pulls", status?.pulls], ["records", status?.records], ["checks", status?.checks]] as const).map(([k, v]) => (
          <div key={k} className="rounded-xl border border-white/[0.07] px-2 py-2 text-center">
            <div className="font-display text-[26px] leading-none">{v ?? 0}</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{k}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex-1">
        <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">Latest</div>
        {events.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 p-4 text-center text-[13px] text-muted">
            Nothing from {APP_NAME[app]} yet.
            <button onClick={onSetup} className="mt-1 block w-full text-[12.5px] text-lane-b hover:underline">
              {app === "claude" ? "Connect Claude Desktop" : "Connect ChatGPT or use Import"}
            </button>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            <AnimatePresence initial={false}>
              {events.map((e) => (
                <motion.li key={eventKey(e)} layout initial={{ opacity: 0, x: app === "chatgpt" ? -8 : 8 }} animate={{ opacity: 1, x: 0 }}
                  className="flex items-start gap-2 text-[13px]">
                  <ActionIcon e={e} />
                  <span className="min-w-0 flex-1 leading-snug">{e.summary}</span>
                  <span className="shrink-0 font-mono text-[10.5px] text-faint">{ago(e.at, br.now)}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </section>
  );
}

const ACTION_LABEL: Record<BridgeAction, string> = { pull: "pull", record: "record", check: "check", import: "import" };

function ActionIcon({ e }: { e: BridgeEvent }) {
  const cls = "mt-0.5 shrink-0";
  if (e.action === "pull") return <ArrowDownToLine size={14} className={cx(cls, "text-lane-b")} aria-label="pull" />;
  if (e.action === "record") return <PenLine size={14} className={cx(cls, "text-muted")} aria-label="record" />;
  if (e.action === "import") return <ClipboardPaste size={14} className={cx(cls, "text-muted")} aria-label="import" />;
  return e.passed === false
    ? <ShieldX size={14} className={cx(cls, "text-fail")} aria-label="check failed" />
    : <ShieldCheck size={14} className={cx(cls, "text-pass")} aria-label="check passed" />;
}

// ---------------------------------------------------------------- the baton

/** Who recorded a line: the app, the person and the turn (the team view). The model is in the tooltip. */
function By({ l }: { l: Pick<ContractLine, "user" | "model" | "turn"> }) {
  const app = appOfLine(l);
  const lane = appLane(app);
  const who = app === "baton" ? `Baton · ${l.user}` : APP_NAME[app];
  const full = `Recorded by ${who}, turn ${l.turn}${l.model ? `, with ${l.model}` : ""}`;
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-px align-middle font-mono text-[10px]"
      style={{ background: lane.soft, color: lane.color }} title={full} aria-label={full}>
      {who}<span className="opacity-60">· t{l.turn}</span>
    </span>
  );
}

function Lines({ lines }: { lines: ContractLine[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {lines.map((l) => <li key={l.item_id} className="text-[13.5px] leading-snug">{l.text}<By l={l} /></li>)}
    </ul>
  );
}

function BatonColumn({ br }: { br: BridgeState }) {
  const c = br.view?.contract;
  const ledger = br.view?.ledger ?? [];
  const empty = !c || (!c.goal && !c.next_step && c.decisions.length + c.constraints.length + c.rejections.length === 0);
  return (
    <section className="surface relative flex min-h-[320px] flex-col gap-4 rounded-2xl p-4" aria-label="The shared baton"
      style={{ boxShadow: "inset 0 0 0 1px rgb(167 139 250 / 0.18)" }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <AppIcon app="baton" size={38} />
          <div>
            <div className="text-[16px] font-medium">The baton</div>
            <div className="text-[12px] text-muted">One contract, every app{c ? ` · ${c.project}` : ""}</div>
          </div>
        </div>
        {c && !empty && <span className="shrink-0 whitespace-nowrap"><CopyButton text={c.rendered} label="Copy baton" /></span>}
      </div>
      {c?.alerts.filter((a) => a.level !== "info").map((a, i) => <AlertBanner key={i} alert={a} />)}
      {!br.view ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-faint">{br.error ? "Bridge unreachable" : "Loading…"}</div>
      ) : empty ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
          <BatonMark size={36} />
          <div className="mt-3 font-display text-2xl">No baton yet for this project</div>
          <p className="mt-1.5 max-w-xs text-[13px] text-muted">
            When ChatGPT or Claude records a goal, a decision or a rejection, it lands here for the other app to pull.
          </p>
        </div>
      ) : (
        <>
          {c!.goal && (
            <Field label="Goal">
              <div className="font-display text-[22px] leading-snug">{c!.goal.text}<By l={c!.goal} /></div>
            </Field>
          )}
          {c!.next_step && (
            <Field label="Next step">
              <motion.div key={c!.next_step.item_id} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }}
                className="baton-gradient rounded-xl p-px">
                <div className="rounded-[11px] bg-ink-2 px-3 py-2.5 text-[15px] leading-snug">{c!.next_step.text}<By l={c!.next_step} /></div>
              </motion.div>
            </Field>
          )}
          {c!.rejections.length > 0 && (
            <Field label="Rejected, don't suggest">
              <ul className="flex flex-col gap-1">
                {c!.rejections.map((r) => (
                  <li key={r.item_id} className="flex flex-wrap items-center gap-x-2 text-[13.5px]">
                    <Ban size={13} className="shrink-0 text-fail" />
                    <span className="font-medium">{r.text}</span>
                    {r.reason && <span className="text-muted">· {r.reason}</span>}
                    <By l={r} />
                  </li>
                ))}
              </ul>
            </Field>
          )}
          {c!.decisions.length + c!.constraints.length + c!.open_questions.length > 0 && (
            <Fold title="Decisions, constraints and questions" count={c!.decisions.length + c!.constraints.length + c!.open_questions.length} defaultOpen>
              <div className="flex flex-col gap-4">
                {c!.decisions.length > 0 && <Field label="Decisions"><Lines lines={c!.decisions} /></Field>}
                {c!.constraints.length > 0 && <Field label="Constraints"><Lines lines={c!.constraints} /></Field>}
                {c!.open_questions.length > 0 && <Field label="Open questions"><Lines lines={c!.open_questions} /></Field>}
              </div>
            </Fold>
          )}
        </>
      )}
      {ledger.length > 0 && (
        <div className="border-t border-white/[0.06] pt-3">
          <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">Ledger</div>
          <ul className="flex flex-col gap-1.5">{ledger.map((r) => <LedgerLine key={r.item_id} r={r} />)}</ul>
        </div>
      )}
    </section>
  );
}

function LedgerLine({ r }: { r: LedgerRow }) {
  const reversed = r.status === "reversed";
  return (
    <li className={cx("flex flex-wrap items-baseline gap-x-2 text-[13px]", reversed && "opacity-55")}>
      <span className={cx("font-medium", reversed && "line-through decoration-muted")}>{r.approach}</span>
      {r.reason && <span className="text-muted">{r.reason}</span>}
      {r.aliases.length > 0 && <span className="text-[11.5px] text-faint">also: {r.aliases.join(", ")}</span>}
      <By l={r} />
      <span className={cx("ml-auto font-mono text-[10.5px]", reversed ? "text-faint" : "text-fail")}>{r.status}</span>
    </li>
  );
}

// ---------------------------------------------------------------- timeline

function Timeline({ br }: { br: BridgeState }) {
  const events = sortEvents(br.view?.events ?? []);
  const repaired = repairedChecks(events);
  return (
    <section className="surface rounded-2xl p-4" aria-label="Relay timeline">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">Relay timeline</div>
        <div className="font-mono text-[10.5px] text-faint">{events.length} event{events.length === 1 ? "" : "s"}</div>
      </div>
      {events.length === 0 ? (
        <div className="py-8 text-center text-[13px] text-muted">Every pull, record, check and import shows up here, newest first.</div>
      ) : (
        <ol className="flex flex-col">
          <AnimatePresence initial={false}>
            {events.map((e) => {
              const k = eventKey(e);
              const fresh = br.fresh.has(k);
              return (
                <motion.li key={k} layout initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                  className={cx("flex items-center gap-3 border-b border-white/[0.05] py-2 last:border-0", fresh && "bg-white/[0.02]")}>
                  <AppIcon app={e.app} size={26} />
                  <ActionIcon e={e} />
                  <span className="w-14 shrink-0 font-mono text-[10.5px] uppercase tracking-wider text-faint">{ACTION_LABEL[e.action]}</span>
                  <span className="min-w-0 flex-1 text-[13.5px] leading-snug">{e.summary}</span>
                  {e.action === "check" && e.passed !== null && (
                    <Tag tone={e.passed ? "pass" : "fail"}>{e.passed ? (repaired.has(k) ? "repaired" : "pass") : "fail"}</Tag>
                  )}
                  <time dateTime={e.at} title={new Date(e.at).toLocaleString()} className="shrink-0 font-mono text-[11px] text-faint">
                    {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </time>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}
    </section>
  );
}
