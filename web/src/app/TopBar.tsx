import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronRight, Code2, FileText, Footprints, Hash, List, MessageSquareOff, MoreHorizontal, RefreshCw, Repeat2, SmilePlus, SquarePen, Waypoints, Zap,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { ModelStatus } from "../api/contract";
import { BatonMark, Wordmark } from "../components/brand";
import { Toggle, cx } from "../components/ui";
import { laneFor, secondsUntil } from "../lib/lanes";
import type { BatonState } from "./useBaton";

/** One slim bar: the relay (model chain), the memory switch, and a menu for demo controls. */
export function TopBar({ b, onTogglePanel, onShowGuide }: { b: BatonState; onTogglePanel: () => void; onShowGuide?: () => void }) {
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
          className="hidden items-center gap-1.5 rounded-xl border border-white/10 px-2.5 py-1.5 text-[13px] text-muted hover:text-fg sm:flex">
          <Waypoints size={15} />Bridge
        </Link>
        <DemoMenu b={b} onShowGuide={onShowGuide} />
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

function DemoMenu({ b, onShowGuide }: { b: BatonState; onShowGuide?: () => void }) {
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
            className="absolute right-0 top-full z-50 mt-2 max-h-[calc(100dvh-5rem)] w-[19rem] overflow-y-auto rounded-2xl border border-white/10 bg-ink-2 p-1.5 shadow-2xl shadow-black/60">
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
            <div className="my-1.5 h-px bg-white/[0.06]" />
            <MenuLabel>Reply checks</MenuLabel>
            <CheckControls b={b} />
            <div className="my-1.5 h-px bg-white/[0.06]" />
            <Link to={`/bridge?project=${encodeURIComponent(b.session?.project ?? "demo")}`} role="menuitem"
              className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-[13.5px] hover:bg-white/[0.06] sm:hidden">
              <Waypoints size={15} className="text-muted" /> Open the Bridge
            </Link>
            {onShowGuide && <MenuItem onClick={act(onShowGuide)} icon={<Footprints size={15} />}>Show demo steps</MenuItem>}
            <MenuItem onClick={act(b.newSession)} icon={<SquarePen size={15} />}>New session</MenuItem>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The style checks every reply is verified against. Sent as session prefs; chips show the result. */
function CheckControls({ b }: { b: BatonState }) {
  const p = b.session?.prefs;
  const [words, setWords] = useState(p?.max_words ? String(p.max_words) : "");
  const [langs, setLangs] = useState(p?.code_languages?.join(", ") ?? "");
  useEffect(() => setWords(p?.max_words ? String(p.max_words) : ""), [p?.max_words]);
  useEffect(() => setLangs(p?.code_languages?.join(", ") ?? ""), [p?.code_languages]);
  if (!p) return null;
  const commitWords = () => {
    const n = parseInt(words, 10);
    const next = Number.isFinite(n) && n > 0 ? n : null;
    if (next !== (p.max_words ?? null)) void b.setPrefs({ max_words: next });
  };
  const commitLangs = () => {
    const list = langs.split(/[\s,]+/).map((l) => l.trim().toLowerCase()).filter(Boolean);
    const next = list.length ? list : null;
    if (JSON.stringify(next) !== JSON.stringify(p.code_languages ?? null)) void b.setPrefs({ code_languages: next });
  };
  const input = "h-7 rounded-lg border border-white/10 bg-black/30 px-2 text-right font-mono text-[12px] outline-none focus:border-lane-b/50";
  return (
    <div className="flex flex-col gap-0.5 px-1 pb-1">
      <CheckRow icon={<List size={15} />} label="No bullet lists">
        <Toggle checked={p.no_bullets} onChange={(v) => b.setPrefs({ no_bullets: v })} label="No bullet lists" />
      </CheckRow>
      <CheckRow icon={<Hash size={15} />} label="Max words" hint="empty = off">
        <input type="number" min={1} inputMode="numeric" value={words} placeholder="off" aria-label="Max words"
          onChange={(e) => setWords(e.target.value)} onBlur={commitWords}
          onKeyDown={(e) => e.key === "Enter" && commitWords()} className={cx(input, "w-16")} />
      </CheckRow>
      <CheckRow icon={<SmilePlus size={15} />} label="No emojis">
        <Toggle checked={!!p.no_emojis} onChange={(v) => b.setPrefs({ no_emojis: v })} label="No emojis" />
      </CheckRow>
      <CheckRow icon={<MessageSquareOff size={15} />} label="No preamble" hint="no “Sure!”, “Great question”">
        <Toggle checked={!!p.no_preamble} onChange={(v) => b.setPrefs({ no_preamble: v })} label="No preamble" />
      </CheckRow>
      <CheckRow icon={<Code2 size={15} />} label="Code languages" hint="e.g. python, ts">
        <input value={langs} placeholder="off" aria-label="Allowed code languages"
          onChange={(e) => setLangs(e.target.value)} onBlur={commitLangs}
          onKeyDown={(e) => e.key === "Enter" && commitLangs()} className={cx(input, "w-24 text-left")} />
      </CheckRow>
    </div>
  );
}

function CheckRow({ icon, label, hint, children }: { icon: ReactNode; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-1.5 py-1.5">
      <span className="text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px]">{label}</span>
        {hint && <span className="block text-[11.5px] text-faint">{hint}</span>}
      </span>
      {children}
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
