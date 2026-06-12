"use client";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { ORM_STYLE_OPTIONS, type OrmStyle } from "@/lib/ormOverlay";

/**
 * "RAIL" map control — toggles the OpenRailwayMap infrastructure overlay and
 * picks its flavour (Infrastructure / Speed / Signals / Power), mirroring the
 * style panel on openrailwaymap.org, plus an opacity slider tuned for the
 * dark basemap. Pairs best with SAT for the full real-railway look.
 */
export default function RailInfraControl() {
  const ormStyle = useStore((s) => s.ormStyle);
  const ormOpacity = useStore((s) => s.ormOpacity);
  const setOrmStyle = useStore((s) => s.setOrmStyle);
  const setOrmOpacity = useStore((s) => s.setOrmOpacity);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close the popover on any outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const active = ormStyle !== "off";

  const pick = (key: OrmStyle) => {
    setOrmStyle(ormStyle === key ? "off" : key);
  };

  return (
    <div ref={rootRef} className="absolute top-[156px] left-4 z-10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="OpenRailwayMap railway infrastructure overlay"
        className={`panel bg-panel/95 backdrop-blur px-3 py-1.5 text-xs font-semibold border transition-colors ${
          active || open
            ? "text-cyan border-cyan/60 bg-cyan/10"
            : "text-muted border-white/20 hover:border-cyan/40 hover:text-cyan"
        }`}
      >
        RAIL
      </button>
      {open && (
        <div className="absolute left-0 top-9 w-56 panel bg-panel/95 backdrop-blur border border-border shadow-lg p-2.5 space-y-1">
          <div className="panel-header mb-1">Railway infrastructure</div>
          {ORM_STYLE_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => pick(o.key)}
              className={`w-full text-left px-2 py-1.5 rounded border transition-colors ${
                ormStyle === o.key
                  ? "border-cyan/60 bg-cyan/10 text-cyan"
                  : "border-transparent text-muted hover:text-text hover:border-white/15"
              }`}
            >
              <div className="text-[11px] font-semibold">{o.label}</div>
              <div className="text-[10px] opacity-70">{o.hint}</div>
            </button>
          ))}
          {active && (
            <div className="pt-1.5 mt-1 border-t border-border/60">
              <div className="flex items-center justify-between text-[10px] text-muted mb-1">
                <span>Opacity</span>
                <span className="font-mono">{Math.round(ormOpacity * 100)}%</span>
              </div>
              <input
                type="range"
                min={30}
                max={100}
                value={Math.round(ormOpacity * 100)}
                onChange={(e) => setOrmOpacity(Number(e.target.value) / 100)}
                className="w-full accent-cyan"
              />
              <div className="text-[10px] text-muted/80 mt-1.5">
                Tip: pairs best with SAT imagery
              </div>
            </div>
          )}
          <div className="text-[9px] text-muted/60 pt-1 leading-snug">
            © OpenRailwayMap (CC-BY-SA) · © OpenStreetMap
          </div>
        </div>
      )}
    </div>
  );
}
