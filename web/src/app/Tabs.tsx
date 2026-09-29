import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Ban, ChevronDown, HelpCircle, Loader2, RefreshCw, Undo2 } from "lucide-react";
import type { ContractLine, LedgerRow, Preferences } from "../api/contract";
import { AlertBanner, Button, Tag, cx } from "../components/ui";
import { laneFor } from "../lib/lanes";
import { CopyButton } from "./Chat";
import { LearningTab } from "./Learning";
import type { BatonState } from "./useBaton";

type TabId = "baton" | "ledger" | "trace" | "learning";
const TABS: { id: TabId; label: string }[] = [
  { id: "baton", label: "Baton" },
  { id: "ledger", label: "Ledger" },
  { id: "trace", label: "Memory" },
  { id: "learning", label: "Learning" },
];

/** The right panel: what the next model will receive, the rejection ledger, and the memory trace. */
export function Tabs({ b }: { b: BatonState }) {
  const [tab, setTab] = useState<TabId>("baton");
  const active = b.ledger.filter((r) => r.status === "active").length;
  return (
    <section className="surface flex h-full min-h-0 flex-col rounded-2xl" aria-label="Task state">
      <div role="tablist" className="m-2 flex rounded-xl bg-black/30 p-1">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cx("relative flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[13px] transition-colors",
              tab === id ? "text-fg" : "text-muted hover:text-fg")}
          >
            {tab === id && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-lg bg-white/[0.08]" />}
            <span className="relative">{label}</span>
            {id === "ledger" && active > 0 && <span className="relative font-mono text-[11px] text-faint">{active}</span>}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2" role="tabpanel">
        {tab === "baton" && <BatonTab b={b} />}
        {tab === "ledger" && <LedgerTab b={b} />}
        {tab === "trace" && <TraceTab b={b} />}
        {tab === "learning" && <LearningTab b={b} />}
      </div>
    </section>
  );
}

function meta(l: ContractLine) {
  return `turn ${l.turn}${l.model ? ` · ${l.model}` : ""} · ${l.user} · ${l.tier === "l2" ? "recalled from long-term memory" : "this session"}`;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11.5px] font-medium text-faint">{label}</div>
      {children}
    </div>
  );
}

export function Fold({ title, count, children, defaultOpen = false }: { title: string; count?: number; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-white/[0.06] pt-3">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-[13px] text-muted hover:text-fg" aria-expanded={open}>
        <ChevronDown size={14} className={cx("transition-transform", !open && "-rotate-90")} />
        {title}
        {count !== undefined && <span className="ml-auto font-mono text-[11px] text-faint">{count}</span>}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="pt-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Lines({ lines }: { lines: ContractLine[] }) {
  if (lines.length === 0) return <div className="text-[12.5px] text-faint">None yet</div>;
  return (
    <ul className="flex flex-col gap-1.5">
      {lines.map((l) => (
        <li key={l.item_id} title={meta(l)} className="text-[13.5px] leading-snug">
          {l.text}
          {l.tier === "l2" && <span className="ml-1.5 font-mono text-[10px] text-faint">recalled</span>}
        </li>
      ))}
    </ul>
  );
}

/** The checked preferences, as short tags. */
export function prefTags(p: Preferences): string[] {
  return [
    ...(p.no_bullets ? ["no bullet lists"] : []),
    ...(p.max_words ? [`max ${p.max_words} words`] : []),
    ...(p.no_emojis ? ["no emojis"] : []),
    ...(p.no_preamble ? ["no preamble"] : []),
    ...(p.code_languages ? [`code: ${p.code_languages.join(", ")}`] : []),
  ];
}

function BatonTab({ b }: { b: BatonState }) {
  const c = b.contract;
  if (!c) return <Empty title="No baton yet" body="Start a session to begin." />;
  const empty = !c.goal && !c.next_step && c.decisions.length + c.constraints.length + c.rejections.length === 0;
  const more = c.decisions.length + c.constraints.length + c.open_questions.length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-[13px] text-muted">What the next model gets</div>
        <CopyButton text={c.rendered} label="Copy baton" onCopy={b.markCopied} />
      </div>
      {c.alerts.filter((a) => a.level !== "info").map((a, i) => <AlertBanner key={i} alert={a} />)}
      {empty ? (
        <Empty title="Nothing to pass yet" body="Chat with the first model. The goal, your decisions and what you reject appear here a moment after each reply." />
      ) : (
        <>
          {c.goal && (
            <Field label="Goal">
              <div className="font-display text-[22px] leading-snug" title={meta(c.goal)}>{c.goal.text}</div>
            </Field>
          )}
          {c.next_step && (
            <Field label="Next step">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[14px] leading-snug" title={meta(c.next_step)}>
                {c.next_step.text}
              </div>
            </Field>
          )}
          {c.rejections.length > 0 && (
            <Field label="Rejected, don't suggest">
              <ul className="flex flex-col gap-1">
                {c.rejections.map((r) => (
                  <li key={r.item_id} title={meta(r)} className="flex items-center gap-2 text-[13.5px]">
                    <Ban size={13} className="shrink-0 text-fail" />
                    <span>{r.text}</span>
                    {r.reason && <span className="text-muted">· {r.reason}</span>}
                  </li>
                ))}
              </ul>
            </Field>
          )}
          {more > 0 && (
            <Fold title="Decisions, constraints and questions" count={more}>
              <div className="flex flex-col gap-4">
                {c.decisions.length > 0 && <Field label="Decisions"><Lines lines={c.decisions} /></Field>}
                {c.constraints.length > 0 && <Field label="Constraints"><Lines lines={c.constraints} /></Field>}
                {c.open_questions.length > 0 && <Field label="Open questions"><Lines lines={c.open_questions} /></Field>}
              </div>
            </Fold>
          )}
          {prefTags(c.preferences).length + c.preferences.free_text.length > 0 && (
            <Field label="Preferences">
              <div className="flex flex-wrap gap-1.5">
                {prefTags(c.preferences).map((t) => <Tag key={t}>{t}</Tag>)}
                {c.preferences.free_text.map((p) => <Tag key={p}>{p}</Tag>)}
              </div>
            </Field>
          )}
        </>
      )}
      <Fold title="Show the raw contract">
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-black/40 p-3 font-mono text-[11.5px] leading-relaxed text-muted">
          {c.rendered}
        </pre>
      </Fold>
    </div>
  );
}

function LedgerTab({ b }: { b: BatonState }) {
  if (b.ledger.length === 0)
    return <Empty title="Nothing rejected yet" body="When you turn an approach down, it lands here with its reason, and every later reply is checked against it." />;
  return (
    <ul className="flex flex-col gap-2">
      {b.ledger.map((r) => <LedgerItem key={r.item_id} r={r} b={b} />)}
    </ul>
  );
}

function LedgerItem({ r, b }: { r: LedgerRow; b: BatonState }) {
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState("");
  const lane = laneFor(r.model, b.models);
  const reversed = r.status === "reversed";
  return (
    <motion.li layout className={cx("rounded-xl border border-white/[0.07] p-3", reversed && "opacity-55")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={cx("text-[15px] font-medium", reversed && "line-through decoration-muted")}>{r.approach}</div>
          {r.reason && <div className="text-[13px] text-muted">{r.reason}</div>}
        </div>
        <span className={cx("font-mono text-[11px]", reversed ? "text-faint" : "text-fail")}>{r.status}</span>
      </div>
      {r.aliases.length > 0 && <div className="mt-1.5 text-[12px] text-faint">Also covers: {r.aliases.join(", ")}</div>}
      <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-faint">
        <span className="size-1.5 rounded-full" style={{ background: lane.color }} />
        turn {r.turn}{r.model && ` · ${r.model}`} · {r.user}
      </div>
      {reversed && r.reversal_reason && <div className="mt-1.5 text-[12px] text-muted">Reversed: {r.reversal_reason}</div>}
      <WhyAnswer b={b} itemId={r.item_id} />
      {!reversed && (
        reversing ? (
          <form className="mt-2.5 flex gap-2" onSubmit={(e) => { e.preventDefault(); void b.reverse(r.item_id, reason); setReversing(false); }}>
            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? (optional)"
              className="h-8 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 text-[13px] outline-none focus:border-white/25" />
            <Button size="sm" type="submit">Reverse</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setReversing(false)}>Cancel</Button>
          </form>
        ) : (
          <div className="mt-2 flex items-center gap-4">
            <button onClick={() => setReversing(true)} className="flex items-center gap-1.5 text-[12.5px] text-muted hover:text-fg">
              <Undo2 size={13} /> Reverse this
            </button>
            <WhyButton b={b} itemId={r.item_id} />
          </div>
        )
      )}
    </motion.li>
  );
}

function WhyButton({ b, itemId }: { b: BatonState; itemId: string }) {
  const w = b.whys[itemId];
  return (
    <button onClick={() => b.askWhy(itemId)} disabled={w?.loading}
      className="flex items-center gap-1.5 text-[12.5px] text-muted hover:text-fg disabled:opacity-50">
      {w?.loading ? <Loader2 size={13} className="animate-spin" /> : <HelpCircle size={13} />}
      {w && !w.loading ? "Ask again" : "Why?"}
    </button>
  );
}

/** Long-term memory's answer to "why did we reject this?", with its sources; or its error. */
function WhyAnswer({ b, itemId }: { b: BatonState; itemId: string }) {
  const w = b.whys[itemId];
  if (!w) return null;
  if (w.loading)
    return <div className="mt-2.5 text-[12.5px] text-muted" role="status">Asking long-term memory… this can take up to 20 s.</div>;
  const v = w.view;
  if (v.error || !v.answer)
    return <div className="mt-2.5 rounded-lg border border-fail/30 bg-fail/[0.07] px-2.5 py-1.5 text-[12.5px] text-red-200" role="alert">
      Couldn't answer: {v.error ?? "no answer came back"}
    </div>;
  return (
    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-2.5 rounded-lg bg-black/30 p-2.5">
      <p className="text-[13px] leading-relaxed">{v.answer}</p>
      {v.sources.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5 border-t border-white/[0.06] pt-2">
          {v.sources.map((s) => <li key={s} className="font-mono text-[10.5px] text-faint">↳ {s}</li>)}
        </ul>
      )}
    </motion.div>
  );
}

function TraceTab({ b }: { b: BatonState }) {
  const t = b.trace;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-[13px] text-muted">
          {t?.fetched_at ? <>Last recall {new Date(t.fetched_at).toLocaleTimeString()}</> : "No recall yet"}
        </div>
        <Button size="sm" variant="ghost" onClick={() => b.refreshMemory()} disabled={b.busy !== null}>
          <RefreshCw size={13} className={cx(b.busy === "refresh" && "animate-spin")} /> Refresh
        </Button>
      </div>
      {t?.alerts.map((a, i) => <AlertBanner key={i} alert={a} />)}
      {t && t.traces.length > 0 && (
        <Field label="What Baton asked long-term memory">
          <ul className="flex flex-col gap-2">
            {t.traces.map((r, i) => (
              <li key={i} className="rounded-xl border border-white/[0.07] p-3">
                <div className="text-[13px]">“{r.query}”</div>
                <div className="mt-1 font-mono text-[11px] text-faint">
                  {r.purpose} · {r.error ? <span className="text-fail">error: {r.error}</span> : <>{r.result_count} results</>} · {r.latency_ms} ms
                </div>
              </li>
            ))}
          </ul>
        </Field>
      )}
      <Fold title="This session (L1)" count={t?.l1_items.length ?? 0} defaultOpen>
        <Lines lines={t?.l1_items ?? []} />
      </Fold>
      <Fold title="Recalled from earlier sessions (L2)" count={t?.l2_items.length ?? 0} defaultOpen>
        <Lines lines={t?.l2_items ?? []} />
      </Fold>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <div className="font-display text-2xl">{title}</div>
      <p className="mt-1.5 max-w-xs text-[13px] text-muted">{body}</p>
    </div>
  );
}
