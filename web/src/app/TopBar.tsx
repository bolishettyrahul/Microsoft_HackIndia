import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, FileText, List, MoreHorizontal, RefreshCw, Repeat2, SquarePen, Waypoints, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import type { ModelStatus } from "../api/contract";
import { BatonMark, Wordmark } from "../components/brand";
import { Toggle, cx } from "../components/ui";
import { laneFor, secondsUntil } from "../lib/lanes";
import type { BatonState } from "./useBaton";

/** One slim bar: the relay (model chain), the memory switch, and a menu for demo controls. */
export function TopBar({ b, onTogglePanel }: { b: BatonState; onTogglePanel: () => void }) {
  const memoryOn = b.session?.memory_on ?? true;
  return (
    <header className="glass relative z-30 flex items-center gap-3 rounded-2xl px-3 py-2 sm:gap-4 sm:px-4">
      <Link to="/" aria-label="Baton home" className="shrink-0"><span className="hidden sm:inline-flex"><Wordmark /></span><BatonMark size={24} className="sm:hidden" /></Link>
      <span className="hidden h-5 w-px bg-white/10 sm:block" />
      <RelayStrip b={b} />
      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
        <label className={cx("flex items-center gap-2.5 rounded-xl border px-3 py-1.5 transition-colors",
          memoryOn ? "border-white/10" : "border-cool/30 bg-cool/[0.06]")}>
          <span className="hidden text-[13px] sm:inline">
            Memory <span className={memoryOn ? "text-fg" : "text-cool"}>{memoryOn ? "ON" : "OFF"}</span>
          </span>
          <Toggle checked={memoryOn} onChange={(v) => b.setMemory(v)} label="Memory" />
        </label>
        <Link to={`/bridge?project=${encodeURIComponent(b.session?.project ?? "demo")}`} title="ChatGPT and Claude on the same baton"
          className="flex items-center gap-1.5 rounded-xl border border-white/10 px-2.5 py-1.5 text-[13px] text-muted hover:text-fg">
          <Waypoints size={15} /><span className="hidden sm:inline">Bridge</span>
        </Link>
        <DemoMenu b={b} />
        <button onClick={onTogglePanel} className="rounded-lg p-2 text-muted hover:bg-white/[0.06] hover:text-fg lg:hidden" aria-label="Show the baton">
          <FileText size={17} />
        </button>
      </div>
    </header>
  );
}

function RelayStrip({ b }: { b: BatonState }) {
  return (
    <ol className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]" aria-label="Model chain">
      {b.models.map((m, i) => (
        <li key={m.model_id} className={cx("shrink-0 items-center gap-1", m.is_active ? "flex" : "hidden md:flex")}>
          {i > 0 && <ChevronRight size={13} className="hidden text-faint md:block" aria-hidden />}
          <ModelPill m={m} b={b} />
        </li>
      ))}
    </ol>
  );
}

function ModelPill({ m, b }: { m: ModelStatus; b: BatonState }) {
  const lane = laneFor(m.model_id, b.models);
  const left = secondsUntil(m.cooldown_until, b.now);
  const usable = !m.is_active && m.state === "ready" && b.busy === null;
  const status =
    m.state === "cooling" ? `cooling ${left}s` : m.state === "benched" ? "benched" : m.state === "disabled" ? "unavailable" : null;
  const pill = (
    <span
      className={cx(
        "relative flex items-center gap-2 rounded-full px-3 py-1 text-[13px] transition-colors",
        m.is_active ? "bg-ink text-fg" : "text-muted",
        usable && "hover:bg-white/[0.06] hover:text-fg",
        (m.state === "benched" || m.state === "disabled") && "opacity-50",
      )}
    >
      {m.is_active ? (
        <BatonMark size={14} />
      ) : (
        <span className="size-1.5 rounded-full" style={{ background: m.state === "cooling" ? "var(--color-cool)" : lane.color }} />
      )}
      <span className="whitespace-nowrap">{m.label}</span>
      {status && (
        <span className={cx("hidden font-mono text-[11px] sm:inline", m.state === "cooling" ? "text-cool" : m.state === "disabled" ? "text-fail" : "text-faint")}>
          {status}
        </span>
      )}
    </span>
  );
  if (m.is_active)
    return (
      <span className="baton-gradient rounded-full p-px" title={`${m.label} has the baton`} aria-current="true">{pill}</span>
    );
  return (
    <button disabled={!usable} onClick={() => b.pickModel(m.model_id)} className="rounded-full disabled:cursor-default"
      title={usable ? `Pass the baton to ${m.label}` : m.detail ?? m.state}>
      {pill}
    </button>
  );
}

function DemoMenu({ b }: { b: BatonState }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const act = (fn: () => unknown) => () => {
    setOpen(false);
    void fn();
  };
  const burstable = b.models.filter((m) => m.burstable);
  const busy = b.busy !== null;

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}
        className={cx("flex items-center gap-1.5 rounded-xl border border-white/10 px-2.5 py-1.5 text-[13px] text-muted hover:text-fg",
          open && "bg-white/[0.06] text-fg")}>
        {b.busy?.startsWith("burst:") ? <Zap size={15} className="animate-pulse text-cool" /> : <MoreHorizontal size={16} />}
        <span className="hidden sm:inline">Controls</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="menu" initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-50 mt-2 w-72 rounded-2xl border border-white/10 bg-ink-2 p-1.5 shadow-2xl shadow-black/60">
            <MenuLabel>Force a handoff</MenuLabel>
            {burstable.map((m) => (
              <MenuItem key={m.model_id} disabled={busy || m.state !== "ready"} onClick={act(() => b.exhaust(m.model_id))}
                icon={<Zap size={15} className="text-cool" />} hint="sends real requests until a 429">
                Exhaust {m.label}
              </MenuItem>
            ))}
            <MenuItem disabled={busy} onClick={act(b.switchModel)} icon={<Repeat2 size={15} />} hint="bench the active model">
              Switch model now
            </MenuItem>
            <div className="my-1.5 h-px bg-white/[0.06]" />
            <MenuLabel>Memory & preferences</MenuLabel>
            <MenuItem disabled={busy} onClick={act(b.refreshMemory)} icon={<RefreshCw size={15} />} hint="recall from Hindsight again">
              Refresh memory
            </MenuItem>
            <MenuItem onClick={act(() => b.setNoBullets(!b.session?.prefs.no_bullets))} icon={<List size={15} />}
              hint={b.session?.prefs.no_bullets ? "on: replies are checked for lists" : "off"}>
              {b.session?.prefs.no_bullets ? "Allow bullet lists" : "No bullet lists"}
            </MenuItem>
            <div className="my-1.5 h-px bg-white/[0.06]" />
            <MenuItem onClick={act(b.newSession)} icon={<SquarePen size={15} />}>New session</MenuItem>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuLabel({ children }: { children: string }) {
  return <div className="px-2.5 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{children}</div>;
}

function MenuItem({ children, icon, hint, onClick, disabled }: {
  children: ReactNode; icon: ReactNode; hint?: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button role="menuitem" onClick={onClick} disabled={disabled}
      className="flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-white/[0.06] disabled:opacity-40 disabled:hover:bg-transparent">
      <span className="mt-0.5 text-muted">{icon}</span>
      <span>
        <span className="block text-[13.5px]">{children}</span>
        {hint && <span className="block text-[11.5px] text-faint">{hint}</span>}
      </span>
    </button>
  );
}
