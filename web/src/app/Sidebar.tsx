import { Flame, RefreshCw, Repeat2, SquarePen, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { Wordmark } from "../components/brand";
import { Button, SectionLabel, StatusLight, Toggle, cx } from "../components/ui";
import { laneFor, secondsUntil } from "../lib/lanes";
import type { BatonState } from "./useBaton";

export function Sidebar({ b }: { b: BatonState }) {
  const { session, models, busy, now } = b;
  if (!session) return null;
  const memoryOn = session.memory_on;

  return (
    <aside className="glass flex h-full flex-col gap-6 overflow-y-auto rounded-2xl p-5">
      <Link to="/" className="w-fit" aria-label="Baton home">
        <Wordmark />
      </Link>

      <div>
        <SectionLabel>Session</SectionLabel>
        <div className="surface rounded-xl p-3 text-[13px]">
          <div className="flex justify-between"><span className="text-muted">Project</span><span className="font-mono">{session.project}</span></div>
          <div className="mt-1 flex justify-between"><span className="text-muted">You</span><span>{session.user}</span></div>
          <div className="mt-1 flex justify-between"><span className="text-muted">Turns</span><span className="font-mono">{session.turns}</span></div>
        </div>
      </div>

      <div>
        <SectionLabel>Memory</SectionLabel>
        <div className={cx(
          "flex items-center justify-between rounded-xl border px-3 py-3 transition-colors",
          memoryOn ? "border-lane-b/30 bg-lane-b/[0.07]" : "border-white/10 bg-white/[0.02]",
        )}>
          <div>
            <div className="text-sm font-medium">{memoryOn ? "Memory ON" : "Memory OFF"}</div>
            <div className="text-[12px] text-muted">{memoryOn ? "The next model gets the baton" : "The next model starts fresh"}</div>
          </div>
          <Toggle checked={memoryOn} onChange={(v) => b.setMemory(v)} label="Memory" />
        </div>
        <label className="mt-3 flex cursor-pointer items-center justify-between rounded-xl px-1 text-[13px]">
          <span>No bullet lists</span>
          <Toggle checked={session.prefs.no_bullets} onChange={(v) => b.setNoBullets(v)} label="No bullet lists" />
        </label>
      </div>

      <div>
        <SectionLabel>Relay (model chain)</SectionLabel>
        <ol className="flex flex-col gap-2">
          {models.map((m) => {
            const lane = laneFor(m.model_id, models);
            const left = secondsUntil(m.cooldown_until, now);
            return (
              <li
                key={m.model_id}
                className={cx("surface relative overflow-hidden rounded-xl p-3 transition-all", m.is_active && "ring-1")}
                style={m.is_active ? { boxShadow: `0 0 0 1px ${lane.ring}, 0 8px 24px -12px ${lane.color}` } : undefined}
              >
                <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: lane.color }} aria-hidden />
                <div className="flex items-center gap-2">
                  <StatusLight state={m.state} />
                  <span className="truncate text-sm font-medium" style={{ color: m.is_active ? lane.color : undefined }}>{m.label}</span>
                  {m.is_active && <span className="ml-auto font-mono text-[10px] uppercase tracking-widest" style={{ color: lane.color }}>baton</span>}
                </div>
                <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-muted">
                  <span>{m.provider}</span>
                  <span>·</span>
                  <span className={cx(m.state === "cooling" && "text-cool", m.state === "disabled" && "text-fail")}>
                    {m.state === "cooling" ? `cooling ${left}s` : m.state}
                  </span>
                </div>
                {m.detail && m.state !== "cooling" && <div className="mt-1 text-[11px] text-muted">{m.detail}</div>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {!m.is_active && (
                    <Button size="sm" variant="outline" disabled={m.state === "cooling" || m.state === "disabled" || busy !== null}
                      onClick={() => b.pickModel(m.model_id)}>
                      Use
                    </Button>
                  )}
                  {m.burstable && (
                    <Button size="sm" variant="danger" disabled={m.state !== "ready" || busy !== null}
                      onClick={() => b.exhaust(m.model_id)} title="Sends real requests until the provider returns a 429">
                      {busy === `burst:${m.model_id}` ? <Flame size={13} className="animate-pulse" /> : <Zap size={13} />}
                      {busy === `burst:${m.model_id}` ? "Bursting…" : "Exhaust rate limit"}
                    </Button>
                  )}
                </div>
                {m.burstable && m.state === "ready" && (
                  <div className="mt-1 font-mono text-[10px] text-faint">sends real requests</div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="mt-auto flex flex-col gap-2">
        <Button variant="outline" onClick={() => b.switchModel()} disabled={busy !== null}>
          <Repeat2 size={15} /> Switch model now
        </Button>
        <Button variant="outline" onClick={() => b.refreshMemory()} disabled={busy !== null}>
          <RefreshCw size={15} className={cx(busy === "refresh" && "animate-spin")} /> Refresh memory
        </Button>
        <Button variant="ghost" onClick={() => b.newSession()}>
          <SquarePen size={15} /> New session
        </Button>
      </div>
    </aside>
  );
}
