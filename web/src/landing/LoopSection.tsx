// "Not one LLM call. A loop." A pulse runs round the turn loop as you scroll; each station
// lights up in turn, and the two branches (429 handoff, repair) split off where they happen.
import { useRef, useState } from "react";
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "motion/react";
import { cx } from "../components/ui";

interface Station { name: string; body: string; kind: "memory" | "code" | "llm"; branch?: { text: string; tone: "cool" | "fail" } }

const STATIONS: Station[] = [
  { name: "Recall", kind: "memory", body: "Merge this session's items (SQLite) with long-term memory (Hindsight) into one typed contract." },
  { name: "Compose", kind: "code", body: "Baton's prompt, then the contract, the patches that work for this model, and the last three turns. Never the whole transcript." },
  {
    name: "Call", kind: "llm", body: "Send it to the active model. This is the only step where the chat model runs.",
    branch: { text: "429? Cool it down, hand the same contract to the next model", tone: "cool" },
  },
  {
    name: "Verify", kind: "code", body: "Plain code checks the reply against the contract: rejected approaches, continuity, your preferences.",
    branch: { text: "A check failed? Go to repair", tone: "fail" },
  },
  { name: "Repair", kind: "code", body: "Retry once with a stronger prompt patch, and record which patch level worked for this model." },
  { name: "Extract", kind: "llm", body: "A small model pulls goals, decisions and rejections out of the turn. Code validates it and redacts secrets." },
  { name: "Retain", kind: "memory", body: "Write the turn to Hindsight, so the next model, or a teammate, starts from here." },
];

const KIND = {
  memory: { label: "memory", color: "var(--color-lane-a)" },
  code: { label: "code", color: "var(--color-pass)" },
  llm: { label: "model call", color: "var(--color-lane-c)" },
} as const;

const CX = 200, CY = 200, R = 140;
const angle = (i: number) => -Math.PI / 2 + (i / STATIONS.length) * Math.PI * 2;
const at = (i: number, r = R) => [CX + r * Math.cos(angle(i)), CY + r * Math.sin(angle(i))] as const;

export function LoopSection() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [active, setActive] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (p) => setActive(Math.min(STATIONS.length - 1, Math.max(0, Math.floor(p * STATIONS.length)))));
  const theta = useTransform(scrollYProgress, (p) => -Math.PI / 2 + p * Math.PI * 2);
  const px = useTransform(theta, (t) => CX + R * Math.cos(t));
  const py = useTransform(theta, (t) => CY + R * Math.sin(t));

  return (
    <section id="loop" ref={ref} className="relative h-[300vh]" aria-label="The Baton turn loop">
      <div className="sticky top-0 flex h-dvh items-center overflow-hidden px-6 pt-20">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-8 md:grid-cols-[1fr_1.05fr] md:gap-14">
          <div className="order-2 md:order-1">
            <div className="mb-4 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
              <span className="baton-text font-semibold">How</span><span className="h-px w-8 bg-white/20" />The turn loop
            </div>
            <h2 className="font-display text-[clamp(2.4rem,5vw,4rem)] leading-[1] tracking-tight">
              Not one LLM call. <i className="baton-text pr-1">A loop.</i>
            </h2>
            <p className="mt-4 max-w-md text-[15.5px] leading-relaxed text-muted">
              Every turn runs seven steps. One of them is the chat model. The rest is memory, and code that checks the model's work.
            </p>
            <ol className="mt-6 flex flex-col gap-1.5">
              {STATIONS.map((s, i) => {
                const on = i === active;
                return (
                  <li key={s.name} className={cx("rounded-xl border px-3.5 transition-all duration-300",
                    on ? "glass border-white/15 py-3" : "border-transparent py-1.5 opacity-55")}>
                    <div className="flex items-center gap-3">
                      <span className="w-5 font-mono text-[11px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                      <span className={cx("font-medium", on ? "text-[16px] text-fg" : "text-[14px] text-muted")}>{s.name}</span>
                      <span className="ml-auto font-mono text-[10px] uppercase tracking-widest" style={{ color: KIND[s.kind].color }}>
                        {KIND[s.kind].label}
                      </span>
                    </div>
                    {on && (
                      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="pl-8">
                        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{s.body}</p>
                        {s.branch && (
                          <div className={cx("mt-2 inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 font-mono text-[11.5px]",
                            s.branch.tone === "cool" ? "border-cool/30 bg-cool/10 text-amber-200" : "border-fail/30 bg-fail/10 text-red-200")}>
                            ↳ {s.branch.text}
                          </div>
                        )}
                      </motion.div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="order-1 mx-auto w-full max-w-[300px] md:order-2 md:max-w-[520px]">
            <svg viewBox="0 0 400 400" className="w-full overflow-visible" role="img" aria-label="A ring of seven steps, repeated every turn">
              <defs>
                <linearGradient id="loop-g" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#38BDF8" /><stop offset=".5" stopColor="#A78BFA" /><stop offset="1" stopColor="#E879F9" />
                </linearGradient>
                <filter id="loop-glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="6" />
                </filter>
                <marker id="arrow-cool" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10 z" fill="#FBBF24" />
                </marker>
                <marker id="arrow-fail" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10 z" fill="#F87171" />
                </marker>
              </defs>

              <circle cx={CX} cy={CY} r={R} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth={2} />
              <motion.circle cx={CX} cy={CY} r={R} fill="none" stroke="url(#loop-g)" strokeWidth={3} strokeLinecap="round"
                transform={`rotate(-90 ${CX} ${CY})`} style={{ pathLength: reduce ? 1 : scrollYProgress }} />

              {/* Branch: 429 at Call loops out to the next model and back in. */}
              <BranchLoop i={2} tone="cool" on={active === 2} label="next model" />
              {/* Branch: a failed check at Verify goes to Repair and back to Verify. */}
              <BranchLoop i={3} tone="fail" on={active === 3 || active === 4} label="retry once" />

              {STATIONS.map((s, i) => {
                const [x, y] = at(i);
                const inside = !!s.branch; // branch loops sit outside, so these names go inside the ring
                const [lx, ly] = at(i, inside ? R - 30 : R + 34);
                const on = i === active;
                const done = i < active;
                return (
                  <g key={s.name}>
                    {on && <circle cx={x} cy={y} r={20} fill={KIND[s.kind].color} opacity={0.45} filter="url(#loop-glow)" />}
                    <circle cx={x} cy={y} r={on ? 15 : 11} fill="#0E1016"
                      stroke={on || done ? KIND[s.kind].color : "rgb(255 255 255 / 0.18)"} strokeWidth={on ? 2.5 : 1.5}
                      style={{ transition: "all .3s" }} />
                    <text x={x} y={y + 3.5} textAnchor="middle" fontSize={on ? 10 : 8.5} fill={on ? "#E8EAF0" : "#8A90A2"}
                      fontFamily="JetBrains Mono Variable, monospace">{i + 1}</text>
                    <text x={lx} y={ly + 4} textAnchor={Math.abs(lx - CX) < 12 ? "middle" : (lx > CX) !== inside ? "start" : "end"}
                      fontSize={on ? 14 : 12} fontWeight={on ? 600 : 400} fill={on ? "#E8EAF0" : "#8A90A2"}
                      fontFamily="Inter Variable, sans-serif" style={{ transition: "all .3s" }}>{s.name}</text>
                  </g>
                );
              })}

              {!reduce && (
                <>
                  <motion.circle cx={px} cy={py} r={14} fill="#A78BFA" opacity={0.5} filter="url(#loop-glow)" />
                  <motion.circle cx={px} cy={py} r={5} fill="#fff" />
                </>
              )}

              <text x={CX} y={CY - 14} textAnchor="middle" fontSize={40} fill="#E8EAF0" fontFamily="Instrument Serif, serif">1 turn</text>
              <text x={CX} y={CY + 10} textAnchor="middle" fontSize={10.5} letterSpacing={1.5} fill="#8A90A2"
                fontFamily="JetBrains Mono Variable, monospace">7 STEPS · 1 CHAT CALL</text>
            </svg>
            <div className="mt-2 flex justify-center gap-4 font-mono text-[10.5px] uppercase tracking-widest">
              {Object.values(KIND).map((k) => (
                <span key={k.label} className="flex items-center gap-1.5 text-muted">
                  <span className="size-2 rounded-full" style={{ background: k.color }} />{k.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** A small loop that leaves a station outward and comes back: a branch that re-enters the ring. */
function BranchLoop({ i, tone, on, label }: { i: number; tone: "cool" | "fail"; on: boolean; label: string }) {
  const a = angle(i);
  const out = R + 62;
  const spread = 0.2;
  const [x1, y1] = [CX + (R + 14) * Math.cos(a - spread / 2), CY + (R + 14) * Math.sin(a - spread / 2)];
  const [x2, y2] = [CX + (R + 14) * Math.cos(a + spread / 2), CY + (R + 14) * Math.sin(a + spread / 2)];
  const [cx1, cy1] = [CX + out * Math.cos(a - spread * 1.6), CY + out * Math.sin(a - spread * 1.6)];
  const [cx2, cy2] = [CX + out * Math.cos(a + spread * 1.6), CY + out * Math.sin(a + spread * 1.6)];
  const [tx, ty] = [CX + (out + 12) * Math.cos(a), CY + (out + 12) * Math.sin(a)];
  const color = tone === "cool" ? "#FBBF24" : "#F87171";
  return (
    <g style={{ opacity: on ? 1 : 0.28, transition: "opacity .3s" }}>
      <path d={`M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`} fill="none" stroke={color} strokeWidth={1.5}
        strokeDasharray="4 4" markerEnd={`url(#arrow-${tone})`} />
      <text x={tx} y={ty + 4} textAnchor={tx > CX ? "start" : "end"} fontSize={10} fill={color}
        fontFamily="JetBrains Mono Variable, monospace">{tone === "cool" ? "429 → " : "fail → "}{label}</text>
    </g>
  );
}
