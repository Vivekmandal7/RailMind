"use client";
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useSimLoop } from "@/components/useSimLoop";
import KpiBar from "@/components/KpiBar";
import AlertsFeed from "@/components/AlertsFeed";
import AiPanel from "@/components/AiPanel";
import WhatIf from "@/components/WhatIf";
import Tracker from "@/components/Tracker";
import Roster from "@/components/Roster";
import TimeScrubber from "@/components/TimeScrubber";
import MapLegend from "@/components/MapLegend";
import "maplibre-gl/dist/maplibre-gl.css";

const NetworkMap = dynamic(() => import("@/components/NetworkMap"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center text-muted text-sm">
      Loading India-wide network…
    </div>
  )
});

export default function Page() {
  useSimLoop();
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [isFs, setIsFs] = useState(false);

  useEffect(() => {
    const handler = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  function toggleFs() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-base overflow-hidden select-none">
      <KpiBar />

      <main className="flex-1 flex gap-2 p-2 overflow-hidden min-h-0">
        {/* Left sidebar */}
        <div className={`flex gap-2 min-h-0 ${leftOpen ? "w-[290px]" : "w-0"} transition-all duration-300`}>
          {leftOpen && (
            <div className="w-[290px] flex flex-col min-h-0">
              <AlertsFeed />
            </div>
          )}
        </div>

        {/* Center */}
        <div className="flex-1 flex flex-col gap-2 min-h-0 relative">
          <div className="panel relative flex-1 overflow-hidden grid-bg">
            <NetworkMap />
            <Tracker />
            <MapLegend />

            {/* floating layout controls */}
            <div className="absolute top-3 right-3 z-20 flex gap-1.5">
              <button
                onClick={() => setLeftOpen(!leftOpen)}
                className="w-8 h-8 rounded-lg bg-panel/90 backdrop-blur border border-border text-muted hover:text-text text-xs flex items-center justify-center"
                title={leftOpen ? "Collapse alerts" : "Expand alerts"}
              >
                {leftOpen ? "◀" : "▶"}
              </button>
              <button
                onClick={() => setRightOpen(!rightOpen)}
                className="w-8 h-8 rounded-lg bg-panel/90 backdrop-blur border border-border text-muted hover:text-text text-xs flex items-center justify-center"
                title={rightOpen ? "Collapse AI panel" : "Expand AI panel"}
              >
                {rightOpen ? "▶" : "◀"}
              </button>
              <button
                onClick={toggleFs}
                className="w-8 h-8 rounded-lg bg-panel/90 backdrop-blur border border-border text-muted hover:text-text text-xs flex items-center justify-center"
                title={isFs ? "Exit fullscreen" : "Enter fullscreen"}
              >
                {isFs ? "⛶" : "⛶"}
              </button>
            </div>
          </div>
          <TimeScrubber />
        </div>

        {/* Right sidebar */}
        <div className={`flex gap-2 min-h-0 ${rightOpen ? "w-[362px]" : "w-0"} transition-all duration-300`}>
          {rightOpen && (
            <div className="w-[362px] flex flex-col gap-2 min-h-0">
              <AiPanel />
              <WhatIf />
            </div>
          )}
        </div>
      </main>

      <div className="h-[124px] px-2 pb-2 min-h-0">
        <Roster />
      </div>
    </div>
  );
}
