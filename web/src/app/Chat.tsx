import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, ChevronDown, Copy, Check, RotateCcw, Wrench } from "lucide-react";
import type { HandoffEvent, ModelStatus, ReplyView, TurnView } from "../api/contract";
import { AlertBanner, Button, Chip, Tag, cx } from "../components/ui";
import { BatonMark } from "../components/brand";
import { laneFor } from "../lib/lanes";
import type { BatonState } from "./useBaton";

/** Render prose with fenced code blocks; everything else keeps its line breaks. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/```/);
  return (
    <div className="flex flex-col gap-2">
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <pre key={i} className="overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-[12.5px]">
            {p.replace(/^[a-z]*\n/, "")}
          </pre>
        ) : (
          p.trim() && <p key={i} className="whitespace-pre-wrap">{p.trim()}</p>
        ),
      )}
    </div>
  );
}

export function CopyButton({ text, label = "Copy", onCopy }: { text: string; label?: string; onCopy?: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          onCopy?.();
          setTimeout(() => setDone(false), 1600);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {done ? <Check size={13} className="text-pass" /> : <Copy size={13} />}
      {done ? "Copied" : label}
    </Button>
  );
}

function handoffCopy(h: HandoffEvent): string {
  const to = h.to_model ? `Baton passed to ${h.to_model}` : "No model left to take the baton";
  const recalled = h.to_model && h.memories_recalled > 0 ? ` · ${h.memories_recalled} memories recalled` : "";
  switch (h.reason) {
    case "429":
      return `${h.from_model} rate-limited${h.retry_after != null ? ` (retry in ${Math.round(h.retry_after)} s)` : ""}. ${to}${recalled}.`;
    case "manual":
      return `You switched off ${h.from_model}. ${to}${recalled}.`;
    case "auth":
      return `${h.from_model} rejected the API key. ${to}${recalled}.`;
    case "bad_request":
      return `${h.from_model} refused the request. ${to}${recalled}.`;
    default:
      return `${h.from_model} failed. ${to}${recalled}.`;
  }
}

function HandoffBanner({ h, models }: { h: HandoffEvent; models: ModelStatus[] }) {
  const to = laneFor(h.to_model, models);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3 py-1" role="status">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-white/15" />
      <span className="flex max-w-[80%] items-center gap-2 text-center text-[12.5px] text-muted">
        <motion.span initial={{ rotate: -90, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ duration: 0.6 }}>
          <BatonMark size={15} />
        </motion.span>
        <span>
          {h.reason === "429" && <span className="mr-1.5 font-mono text-[11px] text-cool">429</span>}
          {handoffCopy(h)}
        </span>
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: to.color }} />
      </span>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-white/15" />
    </motion.div>
  );
}

function ReplyBody({ r, models, muted }: { r: ReplyView; models: ModelStatus[]; muted?: boolean }) {
  const lane = laneFor(r.model_id, models);
  return (
    <div className={cx("flex flex-col gap-2", muted && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="size-1.5 rounded-full" style={{ background: lane.color }} />
        <span className="font-medium text-fg/90">{r.model_label}</span>
        {r.attempt === "repair" && <Tag tone="pass"><Wrench size={10} /> repaired</Tag>}
        {r.attempt === "rerun" && <Tag><RotateCcw size={10} /> re-run</Tag>}
        {!r.memory_on && <Tag>memory off</Tag>}
      </div>
      <div className="text-[14.5px] leading-relaxed text-fg/95"><RichText text={r.text} /></div>
      {r.chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {r.chips.map((c) => <Chip key={c.check_id + c.label} chip={c} />)}
        </div>
      )}
    </div>
  );
}

function Earlier({ attempts, models }: { attempts: ReplyView[]; models: ModelStatus[] }) {
  const [open, setOpen] = useState(false);
  if (attempts.length === 0) return null;
  const label = (r: ReplyView) =>
    r.attempt === "first" && !r.memory_on ? "memory OFF reply" : r.attempt === "first" ? "first attempt" : `${r.attempt} (memory ${r.memory_on ? "ON" : "OFF"})`;
  return (
    <div className="mt-3 border-t border-white/[0.06] pt-2">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-[12px] text-muted hover:text-fg">
        <ChevronDown size={14} className={cx("transition-transform", open && "rotate-180")} />
        {open ? "Hide" : "Show"} {attempts.length === 1 ? label(attempts[0]) : `${attempts.length} earlier attempts`}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden">
            <div className="mt-2 flex flex-col gap-3 rounded-xl border border-dashed border-white/10 p-3">
              {attempts.map((r) => (
                <div key={r.message_id}>
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-faint">{label(r)}</div>
                  <ReplyBody r={r} models={models} muted />
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Turn({ t, b, pending }: { t: TurnView; b: BatonState; pending: boolean }) {
  const lane = laneFor(t.reply?.model_id, b.models);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md border border-white/10 bg-white/[0.07] px-4 py-2.5 text-[14.5px] whitespace-pre-wrap">
          {t.user_text}
        </div>
      </div>
      {t.handoffs.map((h, i) => <HandoffBanner key={i} h={h} models={b.models} />)}
      {t.alerts.map((a, i) =>
        a.level === "info" ? (
          <div key={i} className="text-center text-[12px] text-faint" role="status">{a.message}</div>
        ) : (
          <AlertBanner key={i} alert={a} />
        ),
      )}
      {pending && (
        <div className="surface flex w-fit items-center gap-3 rounded-2xl px-4 py-3 text-[13px] text-muted">
          <span className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-1.5 animate-pulse-soft rounded-full bg-lane-b" style={{ animationDelay: `${i * 0.2}s` }} />
            ))}
          </span>
          {b.busy === "rerun" ? "Re-running…" : "Running the relay: compose, call, verify…"}
        </div>
      )}
      {t.reply && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="surface relative max-w-[92%] rounded-2xl rounded-bl-md px-4 py-3.5"
          style={{ boxShadow: `inset 2px 0 0 ${lane.color}` }}
        >
          <ReplyBody r={t.reply} models={b.models} />
          <Earlier attempts={t.earlier_attempts} models={b.models} />
          {t.can_rerun && t.rerun_memory_on !== null && (
            <div className="mt-3 flex justify-end">
              <Button size="sm" variant={t.rerun_memory_on ? "primary" : "outline"} onClick={() => b.rerun()} disabled={b.busy !== null}>
                <RotateCcw size={13} /> Re-run with memory {t.rerun_memory_on ? "ON" : "OFF"}
              </Button>
            </div>
          )}
        </motion.div>
      )}
      {t.fallback_contract && (
        <div className="surface rounded-2xl p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Every model is cooling. Take the baton with you:</span>
            <CopyButton text={t.fallback_contract} label="Copy baton" onCopy={b.markCopied} />
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[12px] text-muted">{t.fallback_contract}</pre>
        </div>
      )}
    </div>
  );
}

export const SUGGESTIONS = [
  "Plan caching for our FastAPI recall endpoint.",
  "No Redis, we're on a free tier. Use an in-process cache. And no bullet lists.",
  "Let's continue the caching plan. What's the next step?",
  "Give me the steps to wire it in.",
];

export function Chat({ b }: { b: BatonState }) {
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const memoryOn = b.session?.memory_on ?? true;
  const sending = b.busy === "send" || b.busy === "rerun";

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [b.turns, b.busy]);

  const submit = () => {
    const t = text.trim();
    if (!t || sending) return;
    setText("");
    void b.send(t);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };
  const nextSuggestion = SUGGESTIONS[Math.min(b.turns.length, SUGGESTIONS.length - 1)];

  return (
    <section
      className={cx(
        "relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border transition-all duration-500",
        memoryOn ? "border-white/[0.06] bg-ink-2/70" : "border-bench/60 bg-ink-2/70",
      )}
      aria-label="Chat"
    >
      <AnimatePresence>
        {!memoryOn && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="border-b border-bench/40 bg-bench/10 px-5 py-2 text-center text-[12.5px] text-slate-300">
              <b className="font-medium">Memory is off.</b> The next model won't get the baton; it starts fresh, like a new chat in another app.
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-y-auto px-5 py-6">
        {b.turns.length === 0 && (b.session?.turns ?? 0) > 0 ? (
          <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
            <BatonMark size={44} />
            <h2 className="mt-4 font-display text-4xl leading-tight">Earlier messages aren't available.</h2>
            <p className="mt-2 text-[14px] text-muted">
              Earlier messages aren't available after a backend restart. The baton still has everything:
              {" "}{b.session!.turns} turn{b.session!.turns === 1 ? "" : "s"} of decisions are in the side panel, so keep going from the next step.
            </p>
          </div>
        ) : b.turns.length === 0 ? (
          <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
            <BatonMark size={44} />
            <h2 className="mt-4 font-display text-4xl leading-tight">Start the relay.</h2>
            <p className="mt-2 text-[14px] text-muted">
              Plan something with the first model. Baton records the goal, your decisions and what you reject,
              so the next model can pick up where this one stops.
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-7">
            {b.turns.map((t, i) => (
              <Turn key={`${t.turn}-${i}`} t={t} b={b} pending={i === b.turns.length - 1 && sending && (!t.reply || b.busy === "rerun")} />
            ))}
          </div>
        )}
        <div ref={end} />
      </div>

      <div className="border-t border-white/[0.06] p-4">
        <div className="mx-auto max-w-3xl">
          {!sending && (
            <button onClick={() => setText(nextSuggestion)}
              className="mb-2 max-w-full truncate rounded-full border border-white/10 px-3 py-1 text-left text-[12px] text-muted transition-colors hover:border-lane-b/40 hover:text-fg">
              Try: {nextSuggestion}
            </button>
          )}
          <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-black/30 p-2 focus-within:border-white/25">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              rows={1}
              placeholder={memoryOn ? "Message the relay…" : "Message the relay (memory OFF)…"}
              aria-label="Message"
              className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-[14.5px] outline-none placeholder:text-faint"
            />
            <Button variant="primary" onClick={submit} disabled={!text.trim() || sending} aria-label="Send" className="size-10 !px-0">
              <ArrowUp size={18} />
            </Button>
          </div>
          <div className="mt-1.5 px-1 font-mono text-[10.5px] text-faint">Enter to send · Shift+Enter for a new line</div>
        </div>
      </div>
    </section>
  );
}
