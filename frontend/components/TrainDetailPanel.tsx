"use client";

import { fmtClock } from "@/lib/geo";
import { statusLabel } from "@/lib/mapLayers";
import type { TrainSnapshot } from "@/lib/indiaTrains";

interface Props {
  trainNumber: string;
  simSec: number;
  snapshot: TrainSnapshot;
  onClose: () => void;
}

export default function TrainDetailPanel({ snapshot, onClose }: Props) {
  const train = snapshot;

  return (
    <aside className="absolute top-4 right-16 z-10 w-72 panel bg-panel/95 backdrop-blur border border-cyan/30 shadow-lg">
      <div className="flex items-start justify-between gap-2 px-3 py-2 border-b border-white/10">
        <div>
          <p className="text-xs text-muted uppercase tracking-wide">Train</p>
          <p className="text-lg font-bold text-cyan font-mono">{train.number}</p>
          <p className="text-sm text-white/90">{train.name}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-muted hover:text-white text-lg leading-none px-1"
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <dl className="px-3 py-2 space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Status</dt>
          <dd className="font-semibold">{statusLabel(train.status)}</dd>
        </div>
        {train.delayMinutes > 0 && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Delay</dt>
            <dd className="text-amber font-mono">+{train.delayMinutes} min</dd>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Speed</dt>
          <dd className="font-mono">{Math.round(train.speedKmh)} km/h</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Next stop</dt>
          <dd className="font-mono">{train.nextStation ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">ETA</dt>
          <dd className="font-mono">
            {train.etaNextSec != null ? fmtClock(train.etaNextSec) : "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Passengers</dt>
          <dd className="font-mono">{train.estPassengers.toLocaleString()}</dd>
        </div>
        {train.routeStations.length > 0 && (
          <div className="pt-1 border-t border-white/10">
            <dt className="text-muted text-xs mb-1">Route</dt>
            <dd className="text-xs font-mono text-white/70 leading-relaxed">
              {train.routeStations.join(" → ")}
            </dd>
          </div>
        )}
      </dl>
    </aside>
  );
}
