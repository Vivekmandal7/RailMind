"use client";
import { useStore } from "@/store/useStore";

function countdown(sec: number): string {
  if (sec <= 0) return "now";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `T-${m}:${String(s).padStart(2, "0")}`;
}

const sevStyles: Record<string, string> = {
  critical: "border-l-risk bg-risk/5",
  warning: "border-l-amber bg-amber/5",
  info: "border-l-cyan bg-cyan/5"
};
const sevText: Record<string, string> = {
  critical: "text-risk",
  warning: "text-amber",
  info: "text-cyan"
};

export default function AlertsFeed() {
  const alerts = useStore((s) => s.alerts);
  const conflicts = useStore((s) => s.conflicts);
  const focusConflict = useStore((s) => s.focusConflict);
  const setTrack = useStore((s) => s.setTrack);
  const focusConflictId = useStore((s) => s.focusConflictId);

  return (
    <div className="panel flex flex-col shrink-0">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <span className="panel-header">Live Alerts</span>
        <span className="tag text-muted">{alerts.length} active</span>
      </div>
      <div className="scroll-panel max-h-[38vh]">
        {alerts.length === 0 && (
          <div className="p-4 text-xs text-muted">
            No active alerts. Network nominal.
          </div>
        )}
        {alerts.map((a) => (
          <button
            key={a.id}
            onClick={() => {
              const conflict = conflicts.find((c) => c.id === a.id);
              if (conflict) focusConflict(conflict.id);
              else if (a.trains[0]) setTrack(a.trains[0]);
            }}
            className={`w-full text-left px-3 py-2.5 border-b border-border/60 border-l-2 ${
              sevStyles[a.severity]
            } hover:bg-white/5 transition-colors ${
              focusConflictId === a.id ? "ring-1 ring-inset ring-cyan/40 bg-cyan/5" : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <span className={`text-[11px] font-semibold uppercase tracking-wide ${sevText[a.severity]}`}>
                {a.kind}
              </span>
              {a.countdownSec > 0 && (
                <span className={`font-mono text-[11px] ${sevText[a.severity]} ${a.countdownSec < 240 ? "animate-pulseRisk" : ""}`}>
                  {countdown(a.countdownSec)}
                </span>
              )}
            </div>
            <div className="text-xs text-text/90 mt-0.5 leading-snug">{a.message}</div>
            {a.trains.length > 0 && (
              <div className="mt-1 flex gap-1 flex-wrap">
                {a.trains.map((t) => (
                  <span key={t} className="tag text-muted">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
