"use client";
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

const NetworkMap = dynamic(() => import("@/components/NetworkMap"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center text-muted text-sm">
      Loading corridor…
    </div>
  )
});

export default function Page() {
  useSimLoop();

  return (
    <div className="h-screen w-screen flex flex-col bg-base overflow-hidden">
      <KpiBar />

      <main className="flex-1 grid grid-cols-[290px_1fr_362px] gap-2 p-2 overflow-hidden min-h-0">
        <AlertsFeed />

        <div className="flex flex-col gap-2 min-h-0">
          <div className="panel relative flex-1 overflow-hidden grid-bg">
            <NetworkMap />
            <Tracker />
            <MapLegend />
          </div>
          <TimeScrubber />
        </div>

        <div className="flex flex-col gap-2 min-h-0">
          <AiPanel />
          <WhatIf />
        </div>
      </main>

      <div className="h-[124px] px-2 pb-2">
        <Roster />
      </div>
    </div>
  );
}
