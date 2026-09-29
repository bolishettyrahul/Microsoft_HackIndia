import { useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Minus, X } from "lucide-react";
import type { LearningPoint, ModelStatus, PatchStat } from "../api/contract";
import { AlertBanner, cx } from "../components/ui";
import { LEVELS, chosenLevel, verdict } from "../lib/checks";
import { laneFor } from "../lib/lanes";
import type { BatonState } from "./useBaton";

// Lane colours alone don't separate violet from fuchsia for protanopes, so every series also has
// its own marker shape and dash pattern, a direct label, and a legend.
const SHAPES = ["circle", "square", "triangle", "diamond"] as const;
const DASHES = ["", "5 3", "1.5 3", "8 3 2 3"];

function label(model: string, models: ModelStatus[]): string {
  return models.find((m) => m.model_id === model || m.label === model)?.label ?? model.replace(/^[a-z]+:/, "").replace(/^.*\//, "");
}
const short = (s: string) => s.split(" ")[0].replace(/-\d+[a-z]*$/i, "");
const pct = (p: LearningPoint) => (p.checks ? p.failures / p.checks : 0);

function Marker({ shape, x, y, color }: { shape: (typeof SHAPES)[number]; x: number; y: number; color: string }) {
  const ring = { stroke: "var(--color-ink-2)", strokeWidth: 2, fill: color };
  if (shape === "square") return <rect x={x - 4} y={y - 4} width={8} height={8} rx={1.5} {...ring} />;
  if (shape === "triangle") return <path d={`M${x} ${y - 5} L${x + 5} ${y + 4} L${x - 5} ${y + 4} Z`} {...ring} />;
  if (shape === "diamond") return <path d={`M${x} ${y - 5.5} L${x + 5.5} ${y} L${x} ${y + 5.5} L${x - 5.5} ${y} Z`} {...ring} />;
  return <circle cx={x} cy={y} r={4.5} {...ring} />;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11.5px] font-medium text-faint">{title}</div>
      {hint && <p className="mb-2 text-[12px] leading-snug text-muted">{hint}</p>}
      {children}
    </div>
  );
}

/** First-attempt violation rate per model, one point per session, oldest to newest. */
function RateChart({ points, models }: { points: LearningPoint[]; models: ModelStatus[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 328, H = 170, L = 34, R = 52, T = 10, B = 22;
  const series = useMemo(() => {
    const byModel = new Map<string, LearningPoint[]>();
    for (const p of [...points].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)))
      byModel.set(p.model, [...(byModel.get(p.model) ?? []), p]);
    // Stable order: the chain order from /models, then anything else.
    const order = (m: string) => {
      const i = models.findIndex((x) => x.model_id === m || x.label === m);
      return i < 0 ? 99 : i;
    };
    return [...byModel.entries()].sort((a, b) => order(a[0]) - order(b[0]));
  }, [points, models]);

  const times = points.map((p) => Date.parse(p.at));
  const t0 = Math.min(...times), t1 = Math.max(...times);
  const x = (at: string) => L + (t1 === t0 ? 0.5 : (Date.parse(at) - t0) / (t1 - t0)) * (W - L - R);
  const y = (r: number) => T + (1 - r) * (H - T - B);
  // Crosshair columns: points within a few units of each other are one session slot, so a point hidden
  // behind another model's identical point is still listed in the tooltip.
  const cols: { x: number; items: { p: LearningPoint; si: number; model: string }[] }[] = [];
  for (const f of series.flatMap(([model, ps], si) => ps.map((p) => ({ p, si, model }))).sort((a, b) => x(a.p.at) - x(b.p.at))) {
    const last = cols.at(-1);
    if (last && x(f.p.at) - last.x < 8) last.items.push(f);
    else cols.push({ x: x(f.p.at), items: [f] });
  }
  const svgRef = useRef<SVGSVGElement>(null);
  const nearest = (clientX: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * W;
    let best = 0;
    cols.forEach((c, i) => { if (Math.abs(c.x - sx) < Math.abs(cols[best].x - sx)) best = i; });
    return best;
  };

  // Direct labels at the line ends, nudged apart so they never overlap.
  const ends = series.map(([model, ps], si) => ({ si, model, y: y(pct(ps.at(-1)!)) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 12);

  const h = hover === null ? null : cols[hover];
  return (
    <div className="relative">
      <ul className="mb-2 flex flex-wrap gap-x-3 gap-y-1" aria-label="Legend">
        {series.map(([model], si) => (
          <li key={model} className="flex items-center gap-1.5 text-[11.5px] text-muted">
            <svg width="22" height="10" aria-hidden>
              <line x1="1" y1="5" x2="21" y2="5" stroke={laneFor(model, models).color} strokeWidth="2" strokeDasharray={DASHES[si % 4]} />
              <Marker shape={SHAPES[si % 4]} x={11} y={5} color={laneFor(model, models).color} />
            </svg>
            {label(model, models)}
          </li>
        ))}
      </ul>
      <div className="relative">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible outline-none" role="img" tabIndex={0}
        aria-label="First-attempt violation rate per model per session. Use the arrow keys to read each session."
        onMouseMove={(e) => setHover(nearest(e.clientX))} onMouseLeave={() => setHover(null)} onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          e.preventDefault();
          const d = e.key === "ArrowRight" ? 1 : -1;
          setHover((i) => Math.min(cols.length - 1, Math.max(0, (i ?? (d > 0 ? -1 : cols.length)) + d)));
        }}>
        {[0, 0.5, 1].map((r) => (
          <g key={r}>
            <line x1={L} x2={W - R} y1={y(r)} y2={y(r)} stroke="rgb(255 255 255 / 0.07)" />
            <text x={L - 6} y={y(r) + 3.5} textAnchor="end" className="fill-faint font-mono text-[9.5px]">{r * 100}%</text>
          </g>
        ))}
        <text x={L} y={H - 6} className="fill-faint font-mono text-[9.5px]">older</text>
        <text x={W - R} y={H - 6} textAnchor="end" className="fill-faint font-mono text-[9.5px]">latest</text>
        {h && <line x1={h.x} x2={h.x} y1={T} y2={H - B} stroke="rgb(255 255 255 / 0.22)" />}
        {series.map(([model, ps], si) => {
          const color = laneFor(model, models).color;
          return (
            <g key={model}>
              <polyline fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                strokeDasharray={DASHES[si % 4]} points={ps.map((p) => `${x(p.at)},${y(pct(p))}`).join(" ")} />
              {ps.map((p) => <Marker key={p.session_id} shape={SHAPES[si % 4]} x={x(p.at)} y={y(pct(p))} color={color} />)}
            </g>
          );
        })}
        {ends.map((e) => (
          <text key={e.model} x={W - R + 8} y={e.y + 3.5} className="fill-muted text-[10.5px]">{short(label(e.model, models))}</text>
        ))}
        {h && h.items.map((f) => (
          <circle key={f.model} cx={x(f.p.at)} cy={y(pct(f.p))} r={7} fill="none" stroke="var(--color-fg)" strokeWidth={1.5} strokeOpacity={0.6} />
        ))}
      </svg>
      {h && (
        <div role="status" className="pointer-events-none absolute top-1 z-10 w-44 rounded-lg border border-white/10 bg-ink-3/95 px-2.5 py-2 text-[11.5px] shadow-xl shadow-black/50"
          style={h.x / W > 0.5 ? { right: `calc(${100 - (h.x / W) * 100}% + 10px)` } : { left: `calc(${(h.x / W) * 100}% + 10px)` }}>
          <div className="mb-1 font-mono text-[10px] text-faint">
            {new Date(h.items[0].p.at).toLocaleDateString([], { month: "short", day: "numeric" })}
          </div>
          {h.items.map((f) => (
            <div key={f.model} className="flex items-center gap-1.5 py-px">
              <svg width="10" height="10" aria-hidden><Marker shape={SHAPES[f.si % 4]} x={5} y={5} color={laneFor(f.model, models).color} /></svg>
              <span className="min-w-0 flex-1 truncate text-fg">{label(f.model, models)}</span>
              <span className="font-mono text-muted">{f.p.failures}/{f.p.checks}</span>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

const CHECK_LABEL: Record<string, string> = {
  rejected: "rejected", continuity: "continuity", no_bullets: "no-bullets", max_words: "max words",
  no_emojis: "no-emojis", no_preamble: "no-preamble", code_language: "code lang",
};

function LevelCell({ s, inUse }: { s: PatchStat | undefined; inUse: boolean }) {
  const v = verdict(s);
  return (
    <td className="p-0.5">
      <div className={cx("flex items-center justify-center gap-1 rounded-md py-1 font-mono text-[11px]",
        inUse ? "bg-white/[0.06] text-fg ring-1 ring-lane-b/60" : "text-muted")}
        title={`${s ? `${s.passes}/${s.trials} passed` : "no trials"} · ${v === "good" ? "proven good" : v === "bad" ? "proven bad" : "untested"}${inUse ? " · in use" : ""}`}>
        {!s ? <span className="text-faint" aria-label="no trials">·</span> : <>
          {v === "good" ? <Check size={11} className="text-pass" aria-label="proven good" />
            : v === "bad" ? <X size={11} className="text-fail" aria-label="proven bad" />
            : <Minus size={11} className="text-faint" aria-label="untested" />}
          {s.passes}/{s.trials}
        </>}
      </div>
    </td>
  );
}

function PatchTable({ stats, models }: { stats: PatchStat[]; models: ModelStatus[] }) {
  const rows = [...new Set(stats.map((s) => `${s.model}\u0000${s.check_id}`))].map((k) => k.split("\u0000"));
  return (
    <div className="flex flex-col gap-3">
      {[...new Set(rows.map(([m]) => m))].map((model) => (
        <table key={model} className="w-full table-fixed border-collapse">
          <caption className="mb-1 text-left text-[12.5px]">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full" style={{ background: laneFor(model, models).color }} />
              {label(model, models)}
            </span>
          </caption>
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-wider text-faint">
              <th className="w-[34%] text-left font-normal">check</th>
              {LEVELS.map((l) => <th key={l} className="font-normal">L{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.filter(([m]) => m === model).map(([, check]) => {
              const use = chosenLevel(stats, model, check);
              return (
                <tr key={check}>
                  <td className="truncate text-[12px] text-muted">{CHECK_LABEL[check] ?? check}</td>
                  {LEVELS.map((l) => (
                    <LevelCell key={l} inUse={l === use}
                      s={stats.find((s) => s.model === model && s.check_id === check && s.level === l)} />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      ))}
      <p className="text-[11.5px] leading-snug text-faint">
        Passes/trials per patch level. Proven good is 3+ trials at 80%+. The outlined cell is the level Baton uses next:
        the first proven good or untested one.
      </p>
    </div>
  );
}

export function LearningTab({ b }: { b: BatonState }) {
  const l = b.learning;
  const [table, setTable] = useState(false);
  if (!l) return <div className="py-10 text-center text-[13px] text-faint">Loading…</div>;
  const points = l.points.filter((p) => p.checks > 0);
  return (
    <div className="flex flex-col gap-5">
      {l.alerts.map((a, i) => <AlertBanner key={i} alert={a} />)}
      <Section title="First-attempt violations" hint="Share of checks each model failed on its first try, per session, with memory ON. Lower is better.">
        {points.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-[13px] text-muted">
            No history yet. Seed or run a few sessions.
          </div>
        ) : (
          <>
            <RateChart points={points} models={b.models} />
            <button onClick={() => setTable(!table)} className="mt-1 text-[12px] text-muted hover:text-fg" aria-expanded={table}>
              {table ? "Hide" : "Show"} as a table
            </button>
            {table && (
              <table className="mt-2 w-full text-[11.5px]">
                <thead><tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="font-normal">model</th><th className="font-normal">when</th><th className="text-right font-normal">failed</th>
                </tr></thead>
                <tbody>
                  {[...points].sort((a, c) => Date.parse(c.at) - Date.parse(a.at)).map((p) => (
                    <tr key={`${p.model}-${p.session_id}`} className="border-t border-white/[0.05] text-muted">
                      <td className="py-1">{label(p.model, b.models)}</td>
                      <td>{new Date(p.at).toLocaleDateString([], { month: "short", day: "numeric" })}</td>
                      <td className="text-right font-mono">{p.failures}/{p.checks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </Section>
      <Section title="Patch levels" hint="Which strength of prompt patch works for each model and check.">
        {l.stats.length === 0
          ? <div className="text-[12.5px] text-faint">No patch trials yet.</div>
          : <PatchTable stats={l.stats} models={b.models} />}
      </Section>
    </div>
  );
}
