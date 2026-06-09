"use client";

import dynamic from "next/dynamic";

const AlertsFeed = dynamic(() => import("@/components/AlertsFeed"), { ssr: false });
const IncidentTimeline = dynamic(() => import("@/components/IncidentTimeline"), { ssr: false });
const AiEnginePanel = dynamic(() => import("@/components/AiEnginePanel"), { ssr: false });
const AiPanel = dynamic(() => import("@/components/AiPanel"), { ssr: false });
const WhatIf = dynamic(() => import("@/components/WhatIf"), { ssr: false });
const Roster = dynamic(() => import("@/components/Roster"), { ssr: false });
const IndiaMap = dynamic(() => import("@/components/IndiaMap"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted text-sm">
      <div className="w-48 h-3 skeleton" />
      <div className="w-32 h-2 skeleton opacity-60" />
      <span className="text-xs">Loading map…</span>
    </div>
  )
});

interface Props {
  mapKey: number;
}

/**
 * Each side rail is ONE smooth scroll column. Panels keep their natural height
 * (shrink-0) so the AI Engine shows all its modules and recommendation cards
 * render in full — no more clipped fragments inside fixed fractional slots.
 * Only the long event log (Incident Timeline) bounds itself and scrolls inside.
 */
export default function ControlRoomLayout({ mapKey }: Props) {
  return (
    <div className="flex flex-1 min-h-0 gap-0 overflow-hidden">
      <aside className="relative z-10 w-[min(290px,25vw)] shrink-0 flex flex-col gap-2 p-2 min-h-0 border-r border-border bg-base/40 overflow-y-auto scroll-panel">
        <AlertsFeed />
        <IncidentTimeline />
        <AiEnginePanel />
      </aside>

      <main className="relative flex-1 min-w-0 min-h-0 overflow-hidden">
        <IndiaMap key={mapKey} />
      </main>

      <aside className="relative z-10 w-[min(330px,27vw)] shrink-0 flex flex-col gap-2 p-2 min-h-0 border-l border-border bg-base/40 overflow-y-auto scroll-panel">
        <AiPanel />
        <WhatIf />
      </aside>
    </div>
  );
}

export function ControlRoomRoster() {
  return (
    <div className="relative z-10 shrink-0 h-[118px] border-t border-border px-2 py-2 bg-base/40 overflow-hidden pointer-events-auto">
      <Roster />
    </div>
  );
}
