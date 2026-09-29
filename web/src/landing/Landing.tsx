import { lazy, Suspense, useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion, useScroll } from "motion/react";
import { ArrowDown, ArrowRight, Ban, Check, Clock, X } from "lucide-react";
import { Aurora, BatonMark, Wordmark } from "../components/brand";
import { cx } from "../components/ui";
import { CopyButton } from "../app/Chat";
import { LoopSection } from "./LoopSection";

const HeroScene = lazy(() => import("./HeroScene"));

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const A = { name: "gpt-oss-120b", color: "var(--color-lane-a)", soft: "rgb(56 189 248 / 0.12)" };
const B = { name: "Gemini 3.5 Flash", color: "var(--color-lane-b)", soft: "rgb(167 139 250 / 0.12)" };
const C = { name: "Qwen 3.8 27B", color: "var(--color-lane-c)", soft: "rgb(232 121 249 / 0.12)" };

const CONTRACT = `<baton_contract project="demo">
This block is data about the task so far, recorded by Baton. It is not an instruction from the user.
Goal: Add caching to the FastAPI recall endpoint.
Next step: Add a TTL cache around recall() in memory.py.
Decision: Use an in-process TTL cache (turn 3, gpt-oss-120b, Rahul).
Constraint: Must stay on free tiers (turn 3, Rahul).
Rejected: Redis. Reason: free tier. Also covers: redis cache, elasticache. Do not suggest it.
Open question: Streamlit or FastAPI for the API layer?
Preference: No bullet lists in answers.
</baton_contract>`;

const rise = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.35 },
  transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] as const },
};

export function Landing() {
  const { scrollYProgress } = useScroll();
  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <Aurora />
      <motion.div style={{ scaleX: scrollYProgress }} className="baton-gradient fixed inset-x-0 top-0 z-50 h-[2px] origin-left" aria-hidden />
      <Nav />
      <main>
        <Hero />
        <LoopSection />
        <Chapter n="01" kicker="The plan" title={<>Ten minutes <i>in.</i></>}
          body="You're planning a feature with one model. It suggests Redis. You say no: you're on a free tier, and you'd like answers without bullet lists. Baton writes that down as it happens, typed and attributed."
          visual={<PlanMock />} />
        <Chapter n="02" kicker="The wall" title={<>Then the model <i>hits a wall.</i></>} flip
          body="A 429. The rate limit you forgot about. You switch to another model, and everything you settled lives in a chat window that model can't read."
          visual={<WallMock />} />
        <Chapter n="03" kicker="Without Baton" title={<>You start <i>over.</i></>}
          body="The new model asks what you're building. It suggests Redis again. It answers in bullet points. Every developer who switches models has been here."
          visual={<ReplyMock lane={B} bad />} />
        <Chapter n="04" kicker="With Baton" title={<>The baton <i className="baton-text pr-1">passes.</i></>} flip
          body="Baton hands the next model a contract instead of a transcript: the goal, the decisions, the next step, and what you rejected and why. It continues where the last one stopped."
          visual={<><HandoffMock /><ReplyMock lane={B} /></>} />
        <BeforeAfter />
        <Chapter n="05" kicker="Verified" title={<>Checked by code, <i>not by another model.</i></>}
          body="Every reply is checked against the contract with plain, deterministic code. If a check fails, Baton retries once with a stronger prompt patch and records which patch works for each model."
          visual={<ChecksMock />} />
        <Chapter n="06" kicker="Portable" title={<>Take it <i>anywhere.</i></>} flip
          body="The contract is plain text, redacted before it leaves. Copy the baton and paste it into any chat, even one Baton doesn't control."
          visual={<ContractMock />} />
        <Cta />
      </main>
      <footer className="border-t border-white/[0.06] px-6 py-8 text-center font-mono text-[11px] text-faint">
        Baton · Groq · Gemini · Hindsight memory · verified by code
      </footer>
    </div>
  );
}

function Nav() {
  return (
    <div className="fixed inset-x-0 top-4 z-40 flex justify-center px-4">
      <nav className="glass flex w-full max-w-5xl items-center gap-4 rounded-full py-2 pl-5 pr-2">
        <Link to="/" aria-label="Baton home"><Wordmark /></Link>
        <div className="ml-auto hidden items-center gap-6 text-[13px] text-muted sm:flex">
          <a href="#loop" className="hover:text-fg">The loop</a>
          <a href="#story" className="hover:text-fg">The story</a>
          <a href="#verified" className="hover:text-fg">Verification</a>
          <a href="#portable" className="hover:text-fg">Copy baton</a>
        </div>
        <Link to="/app" className="baton-gradient ml-auto inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold text-ink transition hover:brightness-110 sm:ml-0">
          Open app <ArrowRight size={14} />
        </Link>
      </nav>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative flex min-h-dvh flex-col items-center justify-center px-6 pb-16 pt-32 text-center">
      <motion.div {...rise} className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
        <span className="size-1.5 animate-pulse rounded-full bg-lane-b" /> A handoff agent for multi-model work
      </motion.div>
      <motion.h1 {...rise} transition={{ ...rise.transition, delay: 0.05 }}
        className="max-w-5xl font-display text-[clamp(3rem,8vw,6.5rem)] leading-[0.95] tracking-tight">
        Switch models.<br />Keep <i className="baton-text pr-2">the thread.</i>
      </motion.h1>
      <motion.p {...rise} transition={{ ...rise.transition, delay: 0.15 }}
        className="mt-7 max-w-xl text-[17px] leading-relaxed text-muted">
        When a model hits a rate limit, Baton hands the next one your goal, your decisions and what you rejected, and why.
        Then it checks the new model's reply with code.
      </motion.p>
      <motion.div {...rise} transition={{ ...rise.transition, delay: 0.25 }} className="mt-9 flex flex-wrap justify-center gap-3">
        <Link to="/app" className="baton-gradient inline-flex h-12 items-center gap-2 rounded-xl px-6 font-semibold text-ink shadow-[0_10px_40px_-10px_rgb(167_139_250/0.7)] transition hover:-translate-y-0.5 hover:brightness-110">
          Start a session <ArrowRight size={17} />
        </Link>
        <a href="#story" className="glass inline-flex h-12 items-center gap-2 rounded-xl px-6 font-medium text-fg transition hover:bg-white/[0.08]">
          See the story <ArrowDown size={16} />
        </a>
      </motion.div>
      <motion.div {...rise} transition={{ ...rise.transition, delay: 0.35 }} className="mt-6 w-full max-w-6xl">
        <Stage />
      </motion.div>
    </section>
  );
}

/** The 3D handoff scene; the 2D relay track while it loads, or when WebGL is missing. */
function Stage() {
  const reduce = useReducedMotion();
  const webgl = useMemo(hasWebGL, []);
  if (!webgl) return <div className="mx-auto max-w-3xl"><RelayTrack /></div>;
  return (
    <div className="relative h-[clamp(300px,50vh,520px)] w-full">
      <Suspense fallback={<div className="mx-auto max-w-3xl pt-16"><RelayTrack /></div>}>
        <HeroScene still={!!reduce} />
      </Suspense>
    </div>
  );
}

/** Three lanes, one baton, passed down the chain on a loop. */
function RelayTrack() {
  const reduce = useReducedMotion();
  const lanes = [A, B, C];
  return (
    <div className="glass relative rounded-2xl p-5 text-left" aria-hidden>
      <div className="flex flex-col gap-5">
        {lanes.map((l, i) => (
          <div key={l.name} className="relative flex items-center gap-4">
            <span className="w-32 shrink-0 font-mono text-[11px] sm:w-36" style={{ color: l.color }}>{l.name}</span>
            <div className="relative h-[2px] flex-1 rounded-full" style={{ background: `linear-gradient(90deg, ${l.soft}, ${l.color} 50%, ${l.soft})`, opacity: 0.55 }} />
            <span className="w-14 text-right font-mono text-[10px] text-faint">{i === 0 ? "429" : i === 1 ? "active" : "ready"}</span>
          </div>
        ))}
      </div>
      <motion.div
        className="absolute left-[9.5rem] sm:left-[10.5rem]"
        style={{ top: 12 }}
        animate={reduce ? undefined : { x: ["0%", "260%", "260%", "520%", "520%", "0%"], y: [0, 0, 34, 34, 68, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", times: [0, 0.25, 0.4, 0.65, 0.85, 1] }}
      >
        <div className="rounded-full p-1.5 shadow-[0_0_24px_rgb(167_139_250/0.8)]" style={{ background: "rgb(7 8 12 / 0.8)" }}>
          <BatonMark size={20} />
        </div>
      </motion.div>
    </div>
  );
}

function Chapter({
  n, kicker, title, body, visual, flip,
}: { n: string; kicker: string; title: ReactNode; body: string; visual: ReactNode; flip?: boolean }) {
  const id = n === "01" ? "story" : n === "05" ? "verified" : n === "06" ? "portable" : undefined;
  return (
    <section id={id} className="mx-auto grid max-w-6xl md:min-h-[78vh] scroll-mt-24 items-center gap-10 px-6 py-20 md:grid-cols-2 md:gap-16">
      <motion.div {...rise} className={cx(flip && "md:order-2")}>
        <div className="mb-4 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
          <span className="baton-text font-semibold">{n}</span>
          <span className="h-px w-8 bg-white/20" />
          {kicker}
        </div>
        <h2 className="font-display text-[clamp(2.4rem,5vw,4rem)] leading-[1] tracking-tight">{title}</h2>
        <p className="mt-5 max-w-md text-[16.5px] leading-relaxed text-muted">{body}</p>
      </motion.div>
      <motion.div {...rise} transition={{ ...rise.transition, delay: 0.12 }} className={cx("flex flex-col gap-3", flip && "md:order-1")}>
        {visual}
      </motion.div>
    </section>
  );
}

function Bubble({ children, user, lane }: { children: ReactNode; user?: boolean; lane?: typeof A }) {
  return (
    <div className={cx("flex", user && "justify-end")}>
      <div
        className={cx("max-w-[88%] rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed", user ? "rounded-br-md border border-white/10 bg-white/[0.07]" : "surface rounded-bl-md")}
        style={lane ? { boxShadow: `inset 3px 0 0 ${lane.color}` } : undefined}
      >
        {lane && (
          <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-px font-mono text-[11px]" style={{ background: lane.soft, color: lane.color }}>
            <span className="size-1.5 rounded-full" style={{ background: lane.color }} />{lane.name}
          </div>
        )}
        <div>{children}</div>
      </div>
    </div>
  );
}

const stagger = (i: number) => ({
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.6 },
  transition: { delay: 0.25 + i * 0.35, duration: 0.5 },
});

function PlanMock() {
  const lines: [string, string, string?][] = [
    ["Goal", "Add caching to the FastAPI recall endpoint"],
    ["Decision", "Use an in-process TTL cache"],
    ["Rejected", "Redis · free tier", "fail"],
    ["Preference", "No bullet lists"],
  ];
  return (
    <div className="glass flex flex-col gap-3 rounded-2xl p-4">
      <motion.div {...stagger(0)}><Bubble user>Plan caching for our recall endpoint.</Bubble></motion.div>
      <motion.div {...stagger(1)}><Bubble lane={A}>Redis is the usual choice here: fast, shared, with TTLs built in…</Bubble></motion.div>
      <motion.div {...stagger(2)}><Bubble user>No Redis, we're on a free tier. And no bullet lists.</Bubble></motion.div>
      <motion.div {...stagger(3)} className="surface mt-1 rounded-xl p-3">
        <div className="mb-2 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint"><BatonMark size={14} /> recorded to the baton</div>
        <ul className="flex flex-col gap-1.5">
          {lines.map(([k, v, tone], i) => (
            <motion.li key={k} {...stagger(4 + i * 0.5)} className="flex gap-3 text-[13px]">
              <span className="w-20 shrink-0 font-mono text-[11px] uppercase tracking-wider text-faint">{k}</span>
              <span className={tone === "fail" ? "text-red-200" : undefined}>
                {tone === "fail" && <Ban size={12} className="mr-1 inline -translate-y-px text-fail" />}{v}
              </span>
            </motion.li>
          ))}
        </ul>
      </motion.div>
    </div>
  );
}

function WallMock() {
  const reduce = useReducedMotion();
  return (
    <div className="glass relative overflow-hidden rounded-2xl p-8">
      <div className="absolute -right-10 -top-10 size-48 rounded-full bg-cool/20 blur-3xl" aria-hidden />
      <div className="font-mono text-[12px] text-muted">POST /openai/v1/chat/completions</div>
      <div className="mt-3 font-mono text-[clamp(2.6rem,6vw,4.2rem)] font-semibold leading-none text-cool">429</div>
      <div className="mt-1 font-mono text-[15px] text-amber-200">Too Many Requests</div>
      <div className="mt-6 flex items-center gap-4">
        <svg viewBox="0 0 44 44" className="size-14 -rotate-90" aria-hidden>
          <circle cx="22" cy="22" r="19" fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="3" />
          <motion.circle cx="22" cy="22" r="19" fill="none" stroke="var(--color-cool)" strokeWidth="3" strokeLinecap="round"
            initial={{ pathLength: 1 }} whileInView={reduce ? undefined : { pathLength: 0.1 }} viewport={{ once: true }}
            transition={{ duration: 6, ease: "linear" }} />
        </svg>
        <div>
          <div className="flex items-center gap-2 text-[14px]"><Clock size={14} className="text-cool" /> retry-after: 23 s</div>
          <div className="mt-1 flex items-center gap-2 font-mono text-[12px]" style={{ color: A.color }}>
            <span className="size-2 rounded-full bg-cool" /> {A.name} · cooling
          </div>
        </div>
      </div>
      <div className="mt-6 rounded-xl border border-white/[0.07] bg-black/30 p-3 font-mono text-[11.5px] text-muted">
        rate_limit_exceeded: tokens per minute (TPM): Limit 8000, Used 7912, Requested 2511
      </div>
    </div>
  );
}

function ReplyMock({ lane, bad }: { lane: typeof A; bad?: boolean }) {
  const chips = bad
    ? [["continuity", false], ["rejected: Redis", false], ["no-bullets", false]] as const
    : [["continuity", true], ["rejected: Redis", true], ["no-bullets", true]] as const;
  return (
    <div className="glass rounded-2xl p-4">
      <Bubble user>Let's continue the caching plan. What's the next step?</Bubble>
      <div className="mt-3">
        <Bubble lane={lane}>
          {bad ? (
            <>
              Happy to help! Could you share more about <mark className="rounded bg-fail/20 px-0.5 text-red-100">what you're building?</mark> For caching,{" "}
              <mark className="rounded bg-fail/20 px-0.5 text-red-100">Redis is a great option</mark>:
              <span className="mt-1 block font-mono text-[12.5px] text-muted">- fast reads<br />- built-in TTLs</span>
            </>
          ) : (
            <>
              Picking up from the next step: wrap <code className="font-mono text-[12.5px] text-lane-b">recall()</code> in memory.py with an in-process TTL cache.
              Redis stays out because of the free-tier constraint.
            </>
          )}
        </Bubble>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 pl-1">
        {chips.map(([label, ok], i) => (
          <motion.span key={label} {...stagger(i)}
            className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[12px]",
              ok ? "border-pass/30 bg-pass/10 text-pass" : "border-fail/35 bg-fail/10 text-fail")}>
            {ok ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}{label}
          </motion.span>
        ))}
      </div>
    </div>
  );
}

function HandoffMock() {
  const reduce = useReducedMotion();
  return (
    <div className="glass rounded-2xl p-5">
      <div className="relative flex flex-col gap-6">
        {[A, B].map((l) => (
          <div key={l.name} className="flex items-center gap-3">
            <span className="w-32 font-mono text-[11px]" style={{ color: l.color }}>{l.name}</span>
            <div className="h-[2px] flex-1 rounded-full" style={{ background: l.color, opacity: 0.4 }} />
          </div>
        ))}
        <motion.div
          className="absolute left-[8.5rem] top-[-6px]"
          initial={{ x: 0, y: 0 }}
          whileInView={reduce ? undefined : { x: [0, 120, 220], y: [0, 0, 32] }}
          viewport={{ once: true, amount: 0.8 }}
          transition={{ duration: 1.6, delay: 0.3, ease: [0.65, 0, 0.35, 1] }}
        >
          <div className="rounded-full bg-ink/80 p-1 shadow-[0_0_20px_rgb(167_139_250/0.8)]"><BatonMark size={18} /></div>
        </motion.div>
      </div>
      <div className="mt-4 text-[13px] text-muted">
        <span className="font-mono text-[11px] uppercase tracking-widest text-cool">429 handoff</span>{" "}
        gpt-oss-120b rate-limited. Baton passed to Gemini 3.5 Flash · <span className="text-fg">7 memories recalled.</span>
      </div>
    </div>
  );
}

function BeforeAfter() {
  const rows = [
    ["First reply", "Asks what you're building", "Continues from the next step"],
    ["Rejected approach", "Re-suggests Redis", "Skips it, citing the reason"],
    ["Your preference", "Bullet lists again", "Prose, with the patch that works"],
    ["What you retype", "The whole context", "Nothing"],
  ];
  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <motion.div {...rise} className="glass overflow-hidden rounded-2xl">
        <div className="grid grid-cols-[1.1fr_1fr_1fr] border-b border-white/[0.07] px-5 py-3 font-mono text-[11px] uppercase tracking-[0.14em]">
          <span className="text-faint">After the switch</span>
          <span className="text-bench">Memory off</span>
          <span className="baton-text">With Baton</span>
        </div>
        {rows.map(([k, off, on], i) => (
          <motion.div key={k} {...stagger(i)} className="grid grid-cols-[1.1fr_1fr_1fr] gap-3 border-b border-white/[0.05] px-5 py-4 text-[14px] last:border-0">
            <span className="text-muted">{k}</span>
            <span className="flex items-start gap-2 text-slate-400"><X size={15} className="mt-0.5 shrink-0 text-fail" />{off}</span>
            <span className="flex items-start gap-2"><Check size={15} className="mt-0.5 shrink-0 text-pass" />{on}</span>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}

function ChecksMock() {
  const checks = [
    { id: "rejected", how: "Whole-word match on the approach and its aliases, ignoring negations like “avoid” or “instead of”." },
    { id: "continuity", how: "The first reply after a handoff must not ask what the project is." },
    { id: "no_bullets", how: "No line outside code may start with -, *, • or a number." },
  ];
  return (
    <div className="flex flex-col gap-3">
      {checks.map((c, i) => (
        <motion.div key={c.id} {...stagger(i)} className="glass flex gap-4 rounded-2xl p-4">
          <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-pass/12 text-pass"><Check size={15} strokeWidth={3} /></span>
          <div>
            <div className="font-mono text-[13px] text-fg">{c.id}</div>
            <div className="mt-0.5 text-[13.5px] text-muted">{c.how}</div>
          </div>
        </motion.div>
      ))}
      <motion.div {...stagger(3)} className="surface rounded-2xl p-4">
        <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-faint">Repair ladder · one retry</div>
        <div className="grid grid-cols-4 gap-2">
          {["contract", "+ system rule", "+ recency", "+ example"].map((s, i) => (
            <div key={s} className="rounded-lg border border-white/[0.08] p-2 text-center">
              <div className="baton-text font-display text-2xl leading-none">{i}</div>
              <div className="mt-1 text-[11px] text-muted">{s}</div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function ContractMock() {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-faint"><BatonMark size={14} /> the baton</span>
        <CopyButton text={CONTRACT} label="Copy baton" />
      </div>
      <pre className="surface overflow-x-auto whitespace-pre-wrap rounded-xl p-4 font-mono text-[11.5px] leading-relaxed text-muted">
        {CONTRACT.split("\n").map((line, i) => {
          const m = line.match(/^(\w[\w ]*?):(.*)$/);
          return (
            <span key={i} className="block">
              {line.startsWith("<") ? <span className="text-lane-b">{line}</span>
                : m ? <><span className={m[1] === "Rejected" ? "text-fail" : "text-lane-a"}>{m[1]}:</span><span className="text-fg/85">{m[2]}</span></>
                : line}
            </span>
          );
        })}
      </pre>
    </div>
  );
}

function Cta() {
  return (
    <section className="relative px-6 py-32 text-center">
      <motion.div {...rise} className="mx-auto max-w-3xl">
        <BatonMark size={56} className="mx-auto" />
        <h2 className="mt-6 font-display text-[clamp(3rem,7vw,5.5rem)] leading-[0.95] tracking-tight">Pass <i className="baton-text pr-2">the baton.</i></h2>
        <p className="mx-auto mt-5 max-w-lg text-[16.5px] text-muted">
          Plan with one model, exhaust its rate limit for real, and watch the next one pick up the task.
        </p>
        <Link to="/app" className="baton-gradient mt-9 inline-flex h-13 items-center gap-2 rounded-xl px-7 text-[16px] font-semibold text-ink shadow-[0_10px_40px_-10px_rgb(167_139_250/0.7)] transition hover:-translate-y-0.5 hover:brightness-110">
          Start a session <ArrowRight size={18} />
        </Link>
      </motion.div>
    </section>
  );
}
