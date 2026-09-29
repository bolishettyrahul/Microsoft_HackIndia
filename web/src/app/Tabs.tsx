import { useState } from "react";
import { motion } from "motion/react";
import { Ban, Brain, FileText, RefreshCw, Undo2 } from "lucide-react";
import type { ContractLine, LedgerRow } from "../api/contract";
import { AlertBanner, Button, SectionLabel, Tag, cx } from "../components/ui";
import { laneFor } from "../lib/lanes";
import { CopyButton } from "./Chat";
import type { BatonState } from "./useBaton";

type TabId = "baton" | "ledger" | "trace";
const TABS: { id: TabId; label: string; Icon: typeof FileText }[] = [
  { id: "baton", label: "Baton", Icon: FileText },
  { id: "ledger", label: "Ledger", Icon: Ban },
  { id: "trace", label: "Memory trace", Icon: Brain },
];

export function Tabs({ b }: { b: BatonState }) {
  const [tab, setTab] = useState<TabId>("baton");
  const active = b.ledger.filter((r) => r.status === "active").length;
  return (
    <section className="glass flex h-full min-h-0 flex-col rounded-2xl" aria-label="Task state">
      <div role="tablist" className="flex gap-1 border-b border-white/[0.06] p-2">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cx(
              "relative flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors",
              tab === id ? "text-fg" : "text-muted hover:text-fg",
            )}
          >
            {tab === id && (
              <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-xl bg-white/[0.07] ring-1 ring-white/10" />
            )}
            <Icon size={14} className="relative" />
            <span className="relative">{label}</span>
            {id === "ledger" && active > 0 && (
              <span className="relative rounded-full bg-fail/15 px-1.5 font-mono text-[10px] text-fail">{active}</span>
            )}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4" role="tabpanel">
        {tab === "baton" && <BatonTab b={b} />}
        {tab === "ledger" && <LedgerTab b={b} />}
        {tab === "trace" && <TraceTab b={b} />}
      </div>
    </section>
  );
}

function Meta({ l, b }: { l: ContractLine; b: BatonState }) {
  const lane = laneFor(l.model, b.models);
  return (
    <span className="flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] text-faint">
      <Tag className={l.tier === "l2" ? "border-lane-b/30 text-lane-b" : undefined}>{l.tier}</Tag>
      <span>turn {l.turn}</span>
      {l.model && <span style={{ color: lane.color }}>· {l.model}</span>}
      <span>· {l.user}</span>
    </span>
  );
}

function Group({ title, lines, b, tone }: { title: string; lines: ContractLine[]; b: BatonState; tone?: "fail" }) {
  if (lines.length === 0) return null;
  return (
    <div>
      <SectionLabel>{title}</SectionLabel>
      <ul className="flex flex-col gap-1.5">
        {lines.map((l) => (
          <motion.li key={l.item_id} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
            className="surface rounded-xl px-3 py-2">
            <div className={cx("text-[13.5px]", tone === "fail" && "text-red-200")}>
              {tone === "fail" && <Ban size={12} className="mr-1.5 inline -translate-y-px text-fail" />}
              {l.text}
              {l.reason && <span className="text-muted"> · {l.reason}</span>}
            </div>
            <div className="mt-1"><Meta l={l} b={b} /></div>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

function BatonTab({ b }: { b: BatonState }) {
  const c = b.contract;
  if (!c) return <Empty title="No contract yet" body="Start a session to begin." />;
  const empty = !c.goal && !c.next_step && c.decisions.length + c.constraints.length + c.rejections.length === 0;
  return (
    <div className="flex flex-col gap-5">
      {c.alerts.map((a, i) => <AlertBanner key={i} alert={a} />)}
      {empty ? (
        <Empty title="The baton is empty" body="Chat with the first model. Goals, decisions and rejections appear here a moment after each reply." />
      ) : (
        <>
          <div className="grid gap-2">
            {c.goal && <Hero label="Goal" line={c.goal} b={b} />}
            {c.next_step && <Hero label="Next step" line={c.next_step} b={b} accent />}
          </div>
          <Group title="Decisions" lines={c.decisions} b={b} />
          <Group title="Constraints" lines={c.constraints} b={b} />
          <Group title="Rejected" lines={c.rejections} b={b} tone="fail" />
          <Group title="Open questions" lines={c.open_questions} b={b} />
          {(c.preferences.no_bullets || c.preferences.free_text.length > 0) && (
            <div>
              <SectionLabel>Preferences</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {c.preferences.no_bullets && <Tag>no bullet lists</Tag>}
                {c.preferences.free_text.map((p) => <Tag key={p}>{p}</Tag>)}
              </div>
            </div>
          )}
        </>
      )}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <SectionLabel>What the next model receives</SectionLabel>
          <CopyButton text={c.rendered} label="Copy baton" />
        </div>
        <pre className="surface max-h-72 overflow-auto whitespace-pre-wrap rounded-xl p-3 font-mono text-[11.5px] leading-relaxed text-muted">
          {c.rendered}
        </pre>
      </div>
    </div>
  );
}

function Hero({ label, line, b, accent }: { label: string; line: ContractLine; b: BatonState; accent?: boolean }) {
  return (
    <div className={cx("rounded-xl border p-3", accent ? "border-lane-b/30 bg-lane-b/[0.07]" : "surface")}>
      <div className={cx("font-mono text-[10.5px] uppercase tracking-[0.14em]", accent ? "text-lane-b" : "text-faint")}>{label}</div>
      <div className="mt-0.5 font-display text-[22px] leading-snug">{line.text}</div>
      <div className="mt-1"><Meta l={line} b={b} /></div>
    </div>
  );
}

function LedgerTab({ b }: { b: BatonState }) {
  if (b.ledger.length === 0)
    return <Empty title="Nothing rejected yet" body="When you turn an approach down, it lands here with its reason, and every later reply is checked against it." />;
  return (
    <ul className="flex flex-col gap-2.5">
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
    <motion.li layout className={cx("surface rounded-xl p-3.5", reversed && "opacity-60")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={cx("font-display text-2xl leading-none", reversed ? "line-through decoration-muted" : "text-fg")}>{r.approach}</div>
          {r.reason && <div className="mt-1.5 text-[13px] text-muted">Reason: {r.reason}</div>}
        </div>
        <Tag tone={reversed ? "muted" : "fail"}>{r.status}</Tag>
      </div>
      {r.aliases.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {r.aliases.map((a) => <span key={a} className="rounded-md bg-white/[0.05] px-1.5 py-px font-mono text-[11px] text-muted">{a}</span>)}
        </div>
      )}
      <div className="mt-2 font-mono text-[10.5px] text-faint">
        turn {r.turn}{r.model && <span style={{ color: lane.color }}> · {r.model}</span>} · {r.user}
      </div>
      {reversed && r.reversal_reason && <div className="mt-2 text-[12px] text-muted">Reversed: {r.reversal_reason}</div>}
      {!reversed && (
        reversing ? (
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void b.reverse(r.item_id, reason); setReversing(false); }}>
            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? (optional)"
              className="h-8 flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 text-[13px] outline-none focus:border-lane-b/50" />
            <Button size="sm" type="submit">Reverse</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setReversing(false)}>Cancel</Button>
          </form>
        ) : (
          <div className="mt-3">
            <Button size="sm" variant="ghost" onClick={() => setReversing(true)}><Undo2 size={13} /> Reverse</Button>
          </div>
        )
      )}
    </motion.li>
  );
}

function TraceTab({ b }: { b: BatonState }) {
  const t = b.trace;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className="text-[12px] text-muted">
          {t?.fetched_at ? <>Last recall at <span className="font-mono">{new Date(t.fetched_at).toLocaleTimeString()}</span></> : "No recall yet"}
        </div>
        <Button size="sm" onClick={() => b.refreshMemory()} disabled={b.busy !== null}>
          <RefreshCw size={13} className={cx(b.busy === "refresh" && "animate-spin")} /> Refresh
        </Button>
      </div>
      {t?.alerts.map((a, i) => <AlertBanner key={i} alert={a} />)}
      {t && t.traces.length > 0 && (
        <div>
          <SectionLabel>Recall queries (Hindsight)</SectionLabel>
          <ul className="flex flex-col gap-2">
            {t.traces.map((r, i) => (
              <li key={i} className="surface rounded-xl p-3">
                <div className="flex items-center justify-between gap-2">
                  <Tag className="border-lane-b/30 text-lane-b">{r.purpose}</Tag>
                  <span className="font-mono text-[11px] text-muted">
                    {r.error ? <span className="text-fail">error</span> : <>{r.result_count} results</>} · {r.latency_ms} ms
                  </span>
                </div>
                <div className="mt-2 font-mono text-[12px] text-fg/90">“{r.query}”</div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {r.tags.map((tag) => <span key={tag} className="rounded bg-white/[0.05] px-1.5 font-mono text-[10.5px] text-faint">{tag}</span>)}
                </div>
                {r.error && <div className="mt-2 text-[12px] text-fail">{r.error}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <TierList title="L1 · this session (SQLite)" items={t?.l1_items ?? []} empty="Nothing extracted yet" />
        <TierList title="L2 · recalled (Hindsight)" items={t?.l2_items ?? []} empty="Nothing recalled" lane />
      </div>
    </div>
  );
}

function TierList({ title, items, empty, lane }: { title: string; items: ContractLine[]; empty: string; lane?: boolean }) {
  return (
    <div>
      <SectionLabel>{title}</SectionLabel>
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 p-3 text-[12px] text-faint">{empty}</div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((l) => (
            <li key={l.item_id} className={cx("rounded-lg border px-2.5 py-1.5 text-[12.5px]", lane ? "border-lane-b/20 bg-lane-b/[0.05]" : "border-white/[0.07] bg-white/[0.02]")}>
              {l.text}
              <div className="font-mono text-[10px] text-faint">turn {l.turn} · {l.user}</div>
            </li>
          ))}
        </ul>
      )}
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
