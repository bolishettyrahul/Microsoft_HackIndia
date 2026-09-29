import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { AlertTriangle, Check, Info, OctagonAlert, X } from "lucide-react";
import type { Alert, ChipView, ModelState } from "../api/contract";
import type { Lane } from "../lib/lanes";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function Glass({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("glass rounded-2xl", className)} {...rest} />;
}

type Variant = "primary" | "ghost" | "outline" | "danger";
export function Button({
  variant = "outline", size = "md", className, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm",
        variant === "primary" &&
          "baton-gradient text-ink shadow-[0_8px_30px_-8px_rgb(167_139_250/0.6)] hover:brightness-110 hover:-translate-y-px",
        variant === "outline" && "border border-white/10 bg-white/[0.03] text-fg hover:bg-white/[0.07] hover:border-white/20",
        variant === "ghost" && "text-muted hover:text-fg hover:bg-white/[0.05]",
        variant === "danger" && "border border-cool/30 bg-cool/10 text-cool hover:bg-cool/15",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Chip({ chip }: { chip: ChipView }) {
  return (
    <span
      title={chip.evidence}
      className={cx(
        "group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[12px]",
        chip.passed ? "border-pass/30 bg-pass/10 text-pass" : "border-fail/35 bg-fail/10 text-fail",
      )}
    >
      {chip.passed ? <Check size={12} strokeWidth={3} aria-hidden /> : <X size={12} strokeWidth={3} aria-hidden />}
      <span className="sr-only">{chip.passed ? "passed" : "failed"}:</span>
      {chip.label}
    </span>
  );
}

export function Tag({ children, tone = "muted", className }: { children: ReactNode; tone?: "muted" | "pass" | "fail" | "cool" | "lane"; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-px font-mono text-[11px] uppercase tracking-wide",
        tone === "muted" && "border-white/10 text-muted",
        tone === "pass" && "border-pass/30 text-pass",
        tone === "fail" && "border-fail/30 text-fail",
        tone === "cool" && "border-cool/30 text-cool",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ModelBadge({ label, lane, className }: { label: string; lane: Lane; className?: string }) {
  return (
    <span
      className={cx("inline-flex items-center gap-2 rounded-full px-2.5 py-0.5 font-mono text-[12px]", className)}
      style={{ background: lane.soft, color: lane.color, boxShadow: `inset 0 0 0 1px ${lane.ring}` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: lane.color, boxShadow: `0 0 8px ${lane.color}` }} />
      {label}
    </span>
  );
}

const STATE_COLOR: Record<ModelState, string> = {
  ready: "var(--color-pass)",
  cooling: "var(--color-cool)",
  benched: "var(--color-bench)",
  disabled: "var(--color-fail)",
};
export function StatusLight({ state }: { state: ModelState }) {
  return (
    <span className="relative inline-flex size-2.5" aria-label={state} role="img">
      {state === "cooling" && (
        <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: STATE_COLOR[state] }} />
      )}
      <span
        className="relative inline-flex size-2.5 rounded-full"
        style={{ background: STATE_COLOR[state], boxShadow: `0 0 10px ${STATE_COLOR[state]}` }}
      />
    </span>
  );
}

export function Toggle({
  checked, onChange, label, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-300",
        checked ? "baton-gradient border-transparent" : "border-white/15 bg-white/[0.06]",
        "disabled:opacity-40",
      )}
    >
      <span
        className={cx(
          "inline-block size-4.5 rounded-full bg-white shadow-md transition-transform duration-300",
          checked ? "translate-x-[22px]" : "translate-x-[3px] bg-white/70",
        )}
      />
    </button>
  );
}

const ALERT_STYLE = {
  info: { cls: "border-lane-a/25 bg-lane-a/[0.07] text-sky-200", Icon: Info },
  amber: { cls: "border-cool/30 bg-cool/[0.08] text-amber-200", Icon: AlertTriangle },
  red: { cls: "border-fail/35 bg-fail/[0.09] text-red-200", Icon: OctagonAlert },
} as const;
export function AlertBanner({ alert, className }: { alert: Alert; className?: string }) {
  const { cls, Icon } = ALERT_STYLE[alert.level];
  return (
    <div role={alert.level === "red" ? "alert" : "status"} className={cx("flex items-start gap-2.5 rounded-xl border px-3 py-2 text-[13px]", cls, className)}>
      <Icon size={15} className="mt-0.5 shrink-0" aria-hidden />
      <span>
        {alert.message}
        <span className="ml-2 font-mono text-[11px] opacity-60">{alert.code}</span>
      </span>
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-faint">{children}</div>;
}
