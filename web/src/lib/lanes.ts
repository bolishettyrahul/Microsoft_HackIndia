// Each model runs in its own colour lane, by its position in the chain.
export interface Lane { name: string; color: string; soft: string; ring: string }

const LANES: Lane[] = [
  { name: "a", color: "var(--color-lane-a)", soft: "rgb(56 189 248 / 0.12)", ring: "rgb(56 189 248 / 0.35)" },
  { name: "b", color: "var(--color-lane-b)", soft: "rgb(167 139 250 / 0.12)", ring: "rgb(167 139 250 / 0.35)" },
  { name: "c", color: "var(--color-lane-c)", soft: "rgb(232 121 249 / 0.12)", ring: "rgb(232 121 249 / 0.35)" },
];
const OTHER: Lane = { name: "x", color: "var(--color-lane-x)", soft: "rgb(148 163 184 / 0.12)", ring: "rgb(148 163 184 / 0.35)" };

/** The lane for a model id or label, given the chain order from /models. */
export function laneFor(model: string | null | undefined, chain: { model_id: string; label: string }[]): Lane {
  if (!model) return OTHER;
  const i = chain.findIndex((m) => m.model_id === model || m.label === model);
  return i >= 0 && i < LANES.length ? LANES[i] : OTHER;
}

/** Whole seconds left until an ISO timestamp, never negative. */
export function secondsUntil(iso: string | null | undefined, nowMs = Date.now()): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((Date.parse(iso) - nowMs) / 1000));
}

/** Bridge lanes reuse the model lane colours: ChatGPT left, Baton in the middle, Claude right. */
export function appLane(app: "chatgpt" | "claude" | "baton"): Lane {
  return app === "chatgpt" ? LANES[0] : app === "baton" ? LANES[1] : LANES[2];
}
