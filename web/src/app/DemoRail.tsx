import { Check, X } from "lucide-react";
import { cx } from "../components/ui";
import { SUGGESTIONS } from "./Chat";
import { STEPS, demoProgress, type StepId } from "./demoSteps";
import type { BatonState } from "./useBaton";

interface Action { label: string; run?: () => unknown; hint?: string }

/** What the next step asks you to do: one button, or a hint when it's waiting on something else. */
function nextAction(step: StepId, b: BatonState): Action {
  const answered = b.turns.filter((t) => t.reply).length;
  const last = b.turns.at(-1);
  switch (step) {
    case "plan":
      return answered === 0
        ? { label: "Send: plan caching", run: () => b.send(SUGGESTIONS[0]) }
        : { label: "Send: no Redis", run: () => b.send(SUGGESTIONS[1]) };
    case "limit": {
      const active = b.models.find((m) => m.is_active);
      const target = active?.burstable && active.state === "ready" ? active : b.models.find((m) => m.burstable && m.state === "ready");
      return target
        ? { label: `Exhaust ${target.label}`, run: () => b.exhaust(target.model_id) }
        : { label: "", hint: "No Groq model is ready to exhaust" };
    }
    case "off":
      return b.session?.memory_on
        ? { label: "Turn memory OFF", run: () => b.setMemory(false) }
        : { label: "Send: continue", run: () => b.send(SUGGESTIONS[2]) };
    case "rerun":
      return last?.can_rerun && last.rerun_memory_on
        ? { label: "Re-run with memory ON", run: () => b.rerun() }
        : { label: "", hint: "Answer a turn with memory OFF first" };
    case "copy":
      return {
        label: "Copy baton",
        run: async () => {
          if (!b.contract) return;
          try {
            await navigator.clipboard.writeText(b.contract.rendered);
            b.markCopied();
          } catch {
            /* clipboard blocked */
          }
        },
      };
  }
}

/** A thin step rail under the top bar, so each act of the demo reads on its own. */
export function DemoRail({ b, onDismiss }: { b: BatonState; onDismiss: () => void }) {
  const { done, current } = demoProgress({ turns: b.turns, models: b.models, ledgerCount: b.ledger.length, copied: b.copied });
  const action = current ? nextAction(current, b) : null;
  const busy = b.busy !== null;
  return (
    <nav aria-label="Demo steps" className="glass flex items-center gap-2 rounded-2xl px-2 py-1.5 sm:gap-3 sm:px-3">
      <ol className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {STEPS.map((s, i) => {
          const isDone = done[s.id];
          const isNow = s.id === current;
          return (
            <li key={s.id} className="flex shrink-0 items-center gap-1" aria-current={isNow ? "step" : undefined}>
              {i > 0 && <span className={cx("h-px w-3 sm:w-5", isDone || isNow ? "bg-white/25" : "bg-white/10")} aria-hidden />}
              <span className={cx("flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12.5px] transition-colors",
                isNow ? "bg-white/[0.07] text-fg" : isDone ? "text-muted" : "text-faint")}>
                <span className={cx("inline-flex size-4 items-center justify-center rounded-full font-mono text-[10px]",
                  isDone ? "bg-pass/15 text-pass" : isNow ? "baton-gradient text-ink" : "border border-white/15")}>
                  {isDone ? <Check size={10} strokeWidth={3} aria-label="done" /> : i + 1}
                </span>
                <span className={cx(!isNow && "hidden md:inline")}>{s.label}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {action ? (
        action.run ? (
          <button onClick={() => void action.run!()} disabled={busy}
            className="relative shrink-0 rounded-full border border-lane-b/40 bg-lane-b/10 px-3 py-1 text-[12.5px] text-fg transition hover:bg-lane-b/20 disabled:opacity-40">
            {!busy && <span className="absolute inset-0 rounded-full ring-2 ring-lane-b/40 motion-safe:animate-pulse-soft" aria-hidden />}
            <span className="relative">{action.label}</span>
          </button>
        ) : (
          <span className="shrink-0 text-[12px] text-faint">{action.hint}</span>
        )
      ) : (
        <span className="shrink-0 text-[12.5px] text-pass">Demo complete</span>
      )}
      <button onClick={onDismiss} aria-label="Hide the demo steps" className="shrink-0 rounded-lg p-1 text-faint hover:bg-white/[0.06] hover:text-fg">
        <X size={14} />
      </button>
    </nav>
  );
}
