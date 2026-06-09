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
    <div className="panel h-full min-h-0 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0">
        <span className="panel-header">Live Train Roster</span>
        <span className="tag text-muted">{states.filter((t) => t.active).length} live</span>
      </div>
      <div className="flex-1 min-h-0 scroll-x-panel">
        <div className="flex gap-2 p-1.5 h-full items-stretch min-w-min">
          {sorted.map((t) => (
            <button
              key={t.number}
              onClick={() => {
                setTrack(t.number);
                if (t.delayMinutes > 0) showCascade(t.number);
              }}
              className={`min-w-[168px] max-w-[168px] text-left rounded-xl border px-2 py-1.5 transition-colors shrink-0 ${
                selectedTrain === t.number
                  ? "border-cyan/60 bg-cyan/5"
                  : "border-border bg-panel2 hover:bg-white/5"
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-mono text-sm text-text">{t.number}</span>
                <span className={`w-2 h-2 rounded-full shrink-0 ${dot[t.status]}`} />
              </div>
              <div className="text-[10px] text-muted truncate leading-tight">{t.name}</div>
              <div className="flex items-center justify-between mt-1 text-[10px] font-mono">
                <span className={t.delayMinutes >= 5 ? "text-amber" : "text-safe"}>
                  {t.active ? `+${t.delayMinutes}m` : "—"}
                </span>
                <span className="text-muted truncate ml-1">
                  {t.active ? `${Math.round(t.speedKmh)} km/h` : "sched"}
                </span>
              </div>
              <div className="text-[9px] text-muted mt-0.5 font-mono truncate">
                {t.nextStation ? `→ ${t.nextStation}${t.etaNextSec ? ` ${fmtClock(t.etaNextSec)}` : ""}` : "—"}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
