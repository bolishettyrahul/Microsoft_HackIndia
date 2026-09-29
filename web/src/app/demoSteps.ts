// The guided demo rail on /app (planv3 F8): Plan -> Hit 429 -> Memory OFF -> Re-run ON -> Copy baton.
// Every step is worked out from state the app already has, so the rail can't drift from what happened.
import type { ModelStatus, TurnView } from "../api/contract";

export type StepId = "plan" | "limit" | "off" | "rerun" | "copy";

export const STEPS: { id: StepId; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "limit", label: "Hit 429" },
  { id: "off", label: "Memory OFF" },
  { id: "rerun", label: "Re-run ON" },
  { id: "copy", label: "Copy baton" },
];

export interface DemoSnapshot {
  turns: TurnView[];
  models: ModelStatus[];
  ledgerCount: number;
  copied: boolean;
}

export function demoProgress(s: DemoSnapshot): { done: Record<StepId, boolean>; current: StepId | null } {
  const replies = s.turns.flatMap((t) => [...t.earlier_attempts, ...(t.reply ? [t.reply] : [])]);
  const done: Record<StepId, boolean> = {
    plan: s.ledgerCount > 0 || s.turns.filter((t) => t.reply).length >= 2,
    limit: s.turns.some((t) => t.handoffs.some((h) => h.reason === "429")) || s.models.some((m) => m.state === "cooling"),
    off: replies.some((r) => !r.memory_on),
    rerun: s.turns.some((t) => t.reply?.attempt === "rerun" && t.reply.memory_on),
    copy: s.copied,
  };
  return { done, current: STEPS.find((st) => !done[st.id])?.id ?? null };
}
