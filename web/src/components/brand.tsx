import { useId } from "react";
import { cx } from "./ui";

/** Three drifting blurred blobs in the lane colours: the light that the glass frosts. */
export function Aurora({ intensity = 1, className }: { intensity?: number; className?: string }) {
  return (
    <div aria-hidden className={cx("pointer-events-none fixed inset-0 -z-10 overflow-hidden", className)}>
      <div
        className="absolute -left-[10%] -top-[20%] h-[60vh] w-[60vw] rounded-full blur-[120px] animate-drift"
        style={{ background: "var(--color-lane-a)", opacity: 0.16 * intensity }}
      />
      <div
        className="absolute right-[-15%] top-[10%] h-[65vh] w-[55vw] rounded-full blur-[130px] animate-drift [animation-delay:-9s]"
        style={{ background: "var(--color-lane-b)", opacity: 0.18 * intensity }}
      />
      <div
        className="absolute bottom-[-25%] left-[20%] h-[55vh] w-[50vw] rounded-full blur-[140px] animate-drift [animation-delay:-18s]"
        style={{ background: "var(--color-lane-c)", opacity: 0.12 * intensity }}
      />
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "linear-gradient(rgb(255 255 255 / 0.5) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.5) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
        }}
      />
    </div>
  );
}

/** The baton: a gradient bar tilted like it's mid-pass. */
export function BatonMark({ size = 28, className }: { size?: number; className?: string }) {
  const id = `baton-g-${useId().replace(/:/g, "")}`; // unique per instance: a hidden duplicate id blanks the others
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#38BDF8" />
          <stop offset=".5" stopColor="#A78BFA" />
          <stop offset="1" stopColor="#E879F9" />
        </linearGradient>
      </defs>
      <rect x="3" y="12.5" width="26" height="7" rx="3.5" transform="rotate(-35 16 16)" fill={`url(#${id})`} />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <BatonMark size={24} />
      <span className="font-display text-[26px] leading-none tracking-tight">Baton</span>
    </span>
  );
}
