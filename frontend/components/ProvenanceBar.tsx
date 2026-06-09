"use client";

import { useStore } from "@/store/useStore";
import type { ProvenanceSource } from "@/lib/contract";

/** Human label + tone for each provenance class (the brief's legend). */
const LEGEND: Record<
  ProvenanceSource,
  { label: string; cls: string; dot: string }
> = {
  live: { label: "LIVE", cls: "text-safe border-safe/50 bg-safe/10", dot: "bg-safe" },
  interpolated: {
    label: "INTERP",
    cls: "text-cyan border-cyan/40 bg-cyan/10",
    dot: "bg-cyan"
  },
  predicted: {
    label: "PRED",
    cls: "text-amber border-amber/40 bg-amber/10",
    dot: "bg-amber"
  },
  sim: { label: "SIM", cls: "text-muted border-border bg-transparent", dot: "bg-muted" }
};

const ORDER: ProvenanceSource[] = ["live", "interpolated", "predicted", "sim"];

function freshness(ageSec: number | null | undefined): string {
  if (ageSec == null) return "—";
  if (ageSec < 60) return `${Math.round(ageSec)}s ago`;
  if (ageSec < 3600) return `${Math.round(ageSec / 60)}m ago`;
  return `${Math.round(ageSec / 3600)}h ago`;
}

export default function ProvenanceBar() {
  const live = useStore((s) => s.live);
  const states = useStore((s) => s.states);
  const mode = useStore((s) => s.mode);

  // Source counts: prefer the backend's, else derive from train states (local mode).
  const counts: Record<ProvenanceSource, number> = { live: 0, interpolated: 0, predicted: 0, sim: 0 };
  if (live?.source_counts) {
    for (const k of ORDER) counts[k] = live.source_counts[k] ?? 0;
  } else {
    for (const t of states) counts[(t.source as ProvenanceSource) ?? "sim"]++;
  }

  const realFeed = !!live?.available && live.origin === "live";
  // headline: a real NTES feed, honest schedule playback, or pure local sim
  const headline = realFeed
    ? "NTES LIVE"
    : live
      ? "SCHEDULE PLAYBACK"
      : mode === "live"
        ? "ENGINE SIM"
        : "LOCAL SIM";
  const headlineTone = realFeed ? "text-safe" : "text-amber";
  const sub = realFeed
    ? `updated ${freshness(live?.updated_sec_ago)}`
    : "no live feed · honest fallback";

  return (
    <div className="flex items-center gap-3 px-3 border-l border-border shrink-0">
      <div className="flex flex-col leading-tight" title="Data provenance: every train is labelled by how its position is known. No inferred position is shown as GPS.">
        <span className="panel-header whitespace-nowrap">Data Feed</span>
        <span className="flex items-center gap-1.5">
          <span className="relative w-2 h-2">
            <span
              className={`absolute inset-0 rounded-full ${realFeed ? "bg-safe animate-ping" : "bg-amber"} opacity-60`}
            />
            <span className={`absolute inset-0 rounded-full ${realFeed ? "bg-safe" : "bg-amber"}`} />
          </span>
          <span className={`font-mono text-xs ${headlineTone}`}>{headline}</span>
        </span>
        <span className="text-[10px] text-muted font-mono truncate max-w-[140px]">{sub}</span>
      </div>
      <div className="flex items-center gap-1">
        {ORDER.map((k) => {
          const n = counts[k];
          const meta = LEGEND[k];
          const dim = n === 0 ? "opacity-35" : "";
          return (
            <span
              key={k}
              className={`tag flex items-center gap-1 ${meta.cls} ${dim}`}
              title={`${n} train(s) — ${meta.label}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
              {meta.label} {n}
            </span>
          );
        })}
      </div>
    </div>
  );
}
