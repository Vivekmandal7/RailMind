"use client";

import { fmtClockS } from "@/lib/geo";
import { useStore } from "@/store/useStore";
import AnimatedNumber from "@/components/AnimatedNumber";
import DemoMode from "@/components/DemoMode";
import ProvenanceBar from "@/components/ProvenanceBar";

function Kpi({
  label,
  value,
  numeric,
  sub,
  tone = "text"
}: {
  label: string;
  value: string;
  numeric?: number;
  sub?: string;
  tone?: "text" | "safe" | "amber" | "cyan" | "risk";
}) {
  const toneClass =
    tone === "safe"
      ? "text-safe"
      : tone === "amber"
        ? "text-amber"
        : tone === "cyan"
          ? "text-cyan"
          : tone === "risk"
            ? "text-risk"
            : "text-text";
  return (
    <div className="flex flex-col px-3 py-1.5 border-r border-border min-w-[108px] shrink-0">
      <span className="panel-header whitespace-nowrap">{label}</span>
      <span className={`font-mono text-lg leading-tight kpi-tick ${toneClass}`}>
        {numeric !== undefined ? (
          <>
            <AnimatedNumber value={numeric} />
            {value.replace(String(numeric), "")}
          </>
        ) : (
          value
        )}
      </span>
      {sub && <span className="text-[10px] text-muted font-mono truncate max-w-[100px]" title={sub}>{sub}</span>}
    </div>
  );
}

export default function MapKpiBar() {
  const states = useStore((s) => s.states);
  const conflicts = useStore((s) => s.conflicts);
  const simSec = useStore((s) => s.simSec);
  const mode = useStore((s) => s.mode);
  const connected = useStore((s) => s.connected);
  const speed = useStore((s) => s.speed);
  const corridorName = useStore((s) => s.corridorName);

  const live = mode === "live" && connected;

  const active = states.filter((t) => t.active);
  const onTime = active.filter((t) => t.delayMinutes < 5).length;
  const onTimePct = active.length ? Math.round((onTime / active.length) * 100) : 100;
  const risks = conflicts.length;
  const crit = conflicts.filter((c) => c.severity === "critical").length;
  const safety = Math.max(0, 100 - crit * 14 - (risks - crit) * 5);
  const avgDelay = active.length
    ? Math.round(active.reduce((s, t) => s + t.delayMinutes, 0) / active.length)
    : 0;

  return (
    <div className="flex items-stretch h-14 panel rounded-none border-x-0 border-t-0 bg-panel/90 backdrop-blur shrink-0 overflow-hidden">
      <div className="flex items-center gap-2.5 px-3 border-r border-border shrink-0">
        <div className="relative w-2.5 h-2.5">
          <span
            className={`absolute inset-0 rounded-full ${live ? "bg-cyan animate-ping" : "bg-amber"} opacity-60`}
          />
          <span
            className={`absolute inset-0 rounded-full ${live ? "bg-cyan shadow-glow" : "bg-amber"}`}
          />
        </div>
        <div className="leading-tight">
          <div className="font-mono text-sm tracking-wide text-text">RAILMIND</div>
          <div className="panel-header truncate max-w-[180px]" title={corridorName}>
            {corridorName}
          </div>
        </div>
        <span
          className={`tag ml-1 ${
            live
              ? "text-cyan border-cyan/50 bg-cyan/10"
              : mode === "live"
                ? "text-amber border-amber/50 bg-amber/10"
                : "text-muted"
          }`}
          title={
            live
              ? "Streaming from the Python engine over WebSocket"
              : mode === "live"
                ? "Reconnecting to backend…"
                : "In-browser simulation fallback"
          }
        >
          {live ? "LIVE · WS" : mode === "live" ? "RECONNECT…" : "LOCAL"}
        </span>
      </div>
      <div className="flex flex-1 min-w-0 scroll-x-panel items-stretch">
      <Kpi
        label="Sim Clock"
        value={fmtClockS(simSec)}
        sub={`IST · ${speed}× ${live ? "engine" : "sim"}`}
        tone="cyan"
      />
      <Kpi
        label="On-time"
        value={`${onTimePct}%`}
        numeric={onTimePct}
        sub={active.length ? `avg +${avgDelay}m` : "—"}
        tone={onTimePct >= 80 ? "safe" : "amber"}
      />
      <Kpi
        label="Trains Live"
        value={`${active.length}`}
        numeric={active.length}
        sub={states.length ? `of ${states.length} services` : "local sim"}
      />
      <Kpi
        label="Active Risks"
        value={`${risks}`}
        numeric={risks}
        sub={`${crit} critical`}
        tone={crit > 0 ? "risk" : risks > 0 ? "amber" : "safe"}
      />
      <Kpi
        label="Safety Score"
        value={`${safety}`}
        numeric={safety}
        sub="/ 100"
        tone={safety >= 85 ? "safe" : safety >= 60 ? "amber" : "risk"}
      />
      </div>
      <ProvenanceBar />
      <div className="flex items-center px-3 border-l border-border shrink-0">
        <DemoMode />
      </div>
    </div>
  );
}
