"use client";
import { useStore } from "@/store/useStore";
import { fmtClock } from "@/lib/geo";

const SPEEDS = [1, 15, 30, 60, 120, 300];

export default function TimeScrubber() {
  const simSec = useStore((s) => s.simSec);
  const start = useStore((s) => s.windowStart);
  const end = useStore((s) => s.windowEnd);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const setPlaying = useStore((s) => s.setPlaying);
  const setSpeed = useStore((s) => s.setSpeed);
  const scrub = useStore((s) => s.scrub);

  const pct = ((simSec - start) / (end - start)) * 100;

  return (
    <div className="panel bg-panel/95 backdrop-blur px-3 py-2 flex items-center gap-3">
      <button
        onClick={() => setPlaying(!playing)}
        className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-cyan hover:bg-cyan/10"
        title={playing ? "Pause" : "Play"}
      >
        {playing ? "❚❚" : "▶"}
      </button>

      <div className="flex flex-col w-[120px]">
        <span className="panel-header">Sim Clock</span>
        <span className="font-mono text-sm text-cyan">{fmtClock(simSec)}</span>
      </div>

      <div className="flex-1 relative h-8 flex items-center">
        <input
          type="range"
          min={start}
          max={end}
          step={10}
          value={simSec}
          onChange={(e) => scrub(Number(e.target.value))}
          className="w-full accent-cyan cursor-pointer"
        />
        <div
          className="pointer-events-none absolute -bottom-0.5 left-0 text-[9px] font-mono text-muted"
          style={{ left: `clamp(0%, ${pct}%, 92%)` }}
        >
          {fmtClock(simSec)}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <span className="panel-header mr-1">Speed</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`text-[11px] font-mono px-1.5 py-1 rounded-md border ${
              speed === s
                ? "border-cyan/60 text-cyan bg-cyan/10"
                : "border-border text-muted hover:text-text"
            }`}
          >
            {s}×
          </button>
        ))}
      </div>

      <div className="text-[10px] text-muted w-[110px] leading-tight">
        Scrub to forecast network state ahead or replay the window.
      </div>
    </div>
  );
}
