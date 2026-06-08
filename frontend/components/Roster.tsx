"use client";
import { useStore } from "@/store/useStore";
import { fmtClock } from "@/lib/geo";

const dot: Record<string, string> = {
  running: "bg-safe",
  delayed: "bg-amber",
  held: "bg-risk",
  conflict: "bg-risk",
  scheduled: "bg-muted",
  arrived: "bg-muted/50"
};

export default function Roster() {
  const states = useStore((s) => s.states);
  const setTrack = useStore((s) => s.setTrack);
  const selectedTrain = useStore((s) => s.selectedTrain);
  const showCascade = useStore((s) => s.showCascade);

  const sorted = [...states].sort((a, b) => {
    const rank = (x: typeof a) => (x.status === "held" ? 0 : x.status === "delayed" ? 1 : x.active ? 2 : 3);
    return rank(a) - rank(b);
  });

  return (
    <div className="panel h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="panel-header">Live Train Roster</span>
        <span className="tag text-muted">{states.filter((t) => t.active).length} live</span>
      </div>
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-2 p-2 h-full items-stretch">
          {sorted.map((t) => (
            <button
              key={t.number}
              onClick={() => {
                setTrack(t.number);
                if (t.delayMinutes > 0) showCascade(t.number);
              }}
              className={`min-w-[176px] text-left rounded-xl border px-2.5 py-2 transition-colors ${
                selectedTrain === t.number
                  ? "border-cyan/60 bg-cyan/5"
                  : "border-border bg-panel2 hover:bg-white/5"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm text-text">{t.number}</span>
                <span className={`w-2 h-2 rounded-full ${dot[t.status]}`} />
              </div>
              <div className="text-[11px] text-muted truncate">{t.name}</div>
              <div className="flex items-center justify-between mt-1.5 text-[10px] font-mono">
                <span className={t.delayMinutes >= 5 ? "text-amber" : "text-safe"}>
                  {t.active ? `+${t.delayMinutes}m` : "—"}
                </span>
                <span className="text-muted">
                  {t.active ? `${Math.round(t.speedKmh)} km/h` : "scheduled"}
                </span>
              </div>
              <div className="text-[10px] text-muted mt-0.5 font-mono">
                {t.nextStation ? `→ ${t.nextStation} ${t.etaNextSec ? fmtClock(t.etaNextSec) : ""}` : "—"}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
