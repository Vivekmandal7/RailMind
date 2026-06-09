"use client";

import { fmtClock } from "@/lib/geo";
import { SIM_MAX_SEC, SIM_MIN_SEC, SIM_SPEED_PRESETS, type SimSpeedPreset } from "@/lib/trainIcons";

interface Props {
  simSec: number;
  playing: boolean;
  speed: SimSpeedPreset | number;
  simMin?: number;
  simMax?: number;
  live?: boolean;
  onPlayPause: () => void;
  onSpeed: (s: SimSpeedPreset) => void;
  onScrub: (sec: number) => void;
}

export default function SimClockBar({
  simSec,
  playing,
  speed,
  simMin = SIM_MIN_SEC,
  simMax = SIM_MAX_SEC,
  live = false,
  onPlayPause,
  onSpeed,
  onScrub
}: Props) {
  const span = simMax - simMin || 1;
  const pct = ((simSec - simMin) / span) * 100;

  return (
    <div className="absolute bottom-0 inset-x-0 z-20 pointer-events-auto panel bg-panel/95 backdrop-blur border-t border-white/10">
      <div className="flex items-center gap-2 px-3 py-2 min-h-[52px]">
        <button
          type="button"
          onClick={onPlayPause}
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded border border-cyan/40 text-cyan hover:bg-cyan/10 transition-colors text-xs font-bold"
          aria-label={playing ? "Pause simulation" : "Play simulation"}
        >
          {playing ? "❚❚" : "▶"}
        </button>

        <span className="shrink-0 font-mono text-xs sm:text-sm text-cyan tabular-nums w-12">
          {fmtClock(simSec)}
        </span>

        <input
          type="range"
          min={simMin}
          max={simMax}
          step={30}
          value={Math.max(simMin, Math.min(simMax, simSec))}
          onChange={(e) => onScrub(Number(e.target.value))}
          className="flex-1 h-1.5 accent-cyan cursor-pointer min-w-[72px]"
          aria-label="Simulation time"
          style={{
            background: `linear-gradient(to right, rgb(58 208 222 / 0.85) ${pct}%, rgb(255 255 255 / 0.12) ${pct}%)`
          }}
        />

        <div className="shrink-0 hidden sm:flex items-center gap-0.5">
          {SIM_SPEED_PRESETS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSpeed(s)}
              className={`px-1.5 py-0.5 text-[10px] font-mono rounded border transition-colors ${
                speed === s
                  ? "border-cyan/60 bg-cyan/15 text-cyan"
                  : "border-white/15 text-muted hover:border-white/30 hover:text-white"
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        {live && (
          <span className="shrink-0 hidden md:inline text-[10px] font-mono text-cyan/80 uppercase tracking-wide">
            engine
          </span>
        )}
      </div>

      <div className="flex sm:hidden items-center justify-center gap-1 px-3 pb-2 -mt-0.5">
        {SIM_SPEED_PRESETS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSpeed(s)}
            className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-colors ${
              speed === s
                ? "border-cyan/60 bg-cyan/15 text-cyan"
                : "border-white/15 text-muted hover:border-white/30 hover:text-white"
            }`}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
