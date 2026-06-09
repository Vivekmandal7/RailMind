"use client";

import { useStore } from "@/store/useStore";
import { computeStationBoard, type ApproachTrain } from "@/lib/stationBoard";
import { fmtClock } from "@/lib/geo";

function statusHex(s: string): string {
  if (s === "running") return "#34d27a";
  if (s === "delayed") return "#e8a13a";
  if (s === "held" || s === "conflict") return "#ff5a5a";
  return "#7b8694";
}

interface Props {
  code: string;
  onClose: () => void;
}

function InboundRow({ t, held }: { t: ApproachTrain; held?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[11px] py-[3px] border-b border-white/5 last:border-0">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: statusHex(t.status) }} />
      <span className="font-mono text-text shrink-0">{t.number}</span>
      <span className="text-muted truncate flex-1">{t.name}</span>
      {held ? (
        <span className="font-mono text-risk shrink-0">held {t.distKm.toFixed(1)}km</span>
      ) : (
        <>
          <span className="font-mono text-cyan shrink-0">{t.distKm.toFixed(1)}km</span>
          {t.etaNextSec != null && (
            <span className="font-mono text-muted shrink-0">{fmtClock(t.etaNextSec)}</span>
          )}
        </>
      )}
    </div>
  );
}

export default function StationView({ code, onClose }: Props) {
  const station = useStore((s) => s.net.stationMap[code]);
  const states = useStore((s) => s.states);
  if (!station) return null;

  const board = computeStationBoard(station, states);
  const occupied = board.platforms.filter(Boolean).length;

  return (
    <aside className="absolute left-1/2 -translate-x-1/2 top-4 z-20 w-[440px] max-w-[calc(100%-32px)] max-h-[calc(100%-32px)] overflow-y-auto scroll-panel panel bg-panel/95 backdrop-blur border border-cyan/30 shadow-2xl">
      <div className="flex items-start justify-between gap-2 px-4 py-2.5 border-b border-white/10">
        <div>
          <p className="text-[10px] text-muted uppercase tracking-wide">Station · platform board</p>
          <p className="text-lg font-bold text-cyan font-mono leading-tight">{station.code}</p>
          <p className="text-sm text-white/90 leading-tight">{station.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right leading-tight">
            <p className="font-mono text-base text-text">
              {occupied}<span className="text-muted">/{station.platforms}</span>
            </p>
            <p className="panel-header">platforms</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-white text-xl leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      </div>

      {/* 3D platform deck — looking down the platforms from the concourse */}
      <div className="relative px-6 pt-7 pb-4 overflow-hidden">
        {/* receding floor grid for depth */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ perspective: "440px", perspectiveOrigin: "50% 0%" }}
        >
          <div
            style={{
              position: "absolute",
              inset: "-30% -15% -60% -15%",
              transform: "rotateX(62deg)",
              opacity: 0.45,
              backgroundImage:
                "linear-gradient(#1a2433 1px, transparent 1px), linear-gradient(90deg,#1a2433 1px, transparent 1px)",
              backgroundSize: "26px 26px",
              maskImage: "linear-gradient(#000 30%, transparent 92%)",
              WebkitMaskImage: "linear-gradient(#000 30%, transparent 92%)"
            }}
          />
        </div>

        <div className="relative" style={{ perspective: "520px", perspectiveOrigin: "50% 2%" }}>
          <div style={{ transform: "rotateX(56deg)", transformStyle: "preserve-3d" }}>
            {board.platforms.map((t, i) => (
              <div
                key={i}
                className="relative mb-4 rounded-[3px]"
                style={{
                  height: 24,
                  background: "linear-gradient(180deg,#222c3d,#0e131b)",
                  border: "1px solid #2e3a4b",
                  // thick front edge + cast shadow = a solid raised platform
                  boxShadow: "0 8px 0 #06090e, 0 13px 15px rgba(0,0,0,.6)"
                }}
              >
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] font-mono font-bold text-cyan/70 z-10">
                  P{i + 1}
                </span>
                {/* yellow platform edge line */}
                <span
                  className="absolute left-8 right-2 bottom-[3px] h-px"
                  style={{ background: "repeating-linear-gradient(90deg,#f5c84244 0 8px,transparent 8px 16px)" }}
                />
                {t ? (
                  <div
                    className="absolute left-8 right-2 rounded-[5px] overflow-hidden"
                    style={{
                      top: -13,
                      height: 34,
                      transform: "translateZ(26px)",
                      border: `1px solid ${statusHex(t.status)}`,
                      boxShadow: `0 9px 13px rgba(0,0,0,.6), 0 0 15px ${statusHex(t.status)}77`,
                      color: "#0a0f16"
                    }}
                  >
                    {/* coach body: glossy roof + colour + window band */}
                    <div
                      className="absolute inset-0"
                      style={{
                        background: `linear-gradient(180deg,#ffffff70, ${statusHex(t.status)} 22%, ${statusHex(t.status)} 44%, #0a0f1655 46%, #0a0f1655 60%, ${statusHex(t.status)} 62%, ${statusHex(t.status)}cc)`
                      }}
                    />
                    {/* coach divisions */}
                    <div
                      className="absolute inset-0"
                      style={{
                        backgroundImage:
                          "repeating-linear-gradient(90deg, transparent 0 16px, rgba(8,12,18,.4) 16px 18px)"
                      }}
                    />
                    {/* loco nose */}
                    <div
                      className="absolute top-0 bottom-0 right-0 w-2"
                      style={{ background: "rgba(8,12,18,.55)" }}
                    />
                    <div className="absolute inset-0 flex items-center gap-1.5 px-2">
                      <span className="font-mono text-[12px] font-extrabold tracking-tight drop-shadow-sm">
                        {t.number}
                      </span>
                      <span className="text-[9px] font-semibold truncate opacity-90">{t.name}</span>
                      {t.delayMinutes > 0 && (
                        <span className="ml-auto mr-2 font-mono text-[9px] font-bold shrink-0">
                          +{t.delayMinutes}m
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <span className="absolute left-8 top-1/2 -translate-y-1/2 text-[9px] text-muted/40 italic z-10">
                    clear
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 pb-3 space-y-2.5">
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="panel-header">Approaching</span>
            <span className="tag text-cyan border-cyan/30">{board.approaching.length}</span>
          </div>
          {board.approaching.length === 0 ? (
            <p className="text-[10px] text-muted/60 italic py-1">None inbound</p>
          ) : (
            board.approaching.map((t) => <InboundRow key={t.number} t={t} />)
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="panel-header">Held outside</span>
            <span className={`tag ${board.held.length > 0 ? "text-risk border-risk/40 bg-risk/10" : "text-muted border-border"}`}>
              {board.held.length}
            </span>
          </div>
          {board.held.length === 0 ? (
            <p className="text-[10px] text-muted/60 italic py-1">None waiting</p>
          ) : (
            board.held.map((t) => <InboundRow key={t.number} t={t} held />)
          )}
        </div>
      </div>
    </aside>
  );
}
