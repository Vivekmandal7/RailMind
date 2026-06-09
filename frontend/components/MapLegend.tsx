"use client";
import { useStore } from "@/store/useStore";

const items = [
  { c: "bg-safe", l: "On time" },
  { c: "bg-amber", l: "Delayed" },
  { c: "bg-risk", l: "Held / conflict" },
  { c: "bg-cyan", l: "Cascade / reroute" }
];

export default function MapLegend() {
  const passengerLayer = useStore((s) => s.passengerLayer);
  const demoActive = useStore((s) => s.demoActive);
  return (
    <div className="absolute bottom-20 left-3 z-10 panel bg-panel/90 backdrop-blur px-2.5 py-2 max-w-[180px] transition-opacity duration-300 pointer-events-none">
      <div className="panel-header mb-1.5">Legend</div>
      <div className="space-y-1">
        {items.map((i) => (
          <div key={i.l} className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${i.c} transition-colors duration-300`} />
            <span className="text-[10px] text-muted">{i.l}</span>
          </div>
        ))}
        <div className="flex items-center gap-2 pt-1 border-t border-border/60 mt-1">
          <span className="w-4 h-[3px] rounded bg-[#785f28]" />
          <span className="text-[10px] text-muted">Single line (ghat)</span>
        </div>
        {passengerLayer && (
          <div className="text-[10px] text-amber pt-1">Tracks shaded by passenger load</div>
        )}
        {demoActive && (
          <div className="text-[10px] text-cyan pt-1 animate-pulse">Demo mode active</div>
        )}
      </div>
    </div>
  );
}
