"use client";
import { useRef, useEffect } from "react";
import { useStore } from "@/store/useStore";
import { fmtClockS } from "@/lib/geo";
import type { TimelineEvent } from "@/lib/types";

const kindIcon: Record<string, string> = {
  conflict: "⚠",
  forecast: "◎",
  optimize: "⚙",
  verify: "✓",
  apply: "▶",
  blocked: "⊘",
  inject: "⚡",
  clear: "↺",
  outcome: "●"
};

const sevDot: Record<string, string> = {
  critical: "bg-risk",
  warning: "bg-amber",
  info: "bg-cyan",
  safe: "bg-safe"
};

function EventRow({
  ev,
  active,
  onJump
}: {
  ev: TimelineEvent;
  active: boolean;
  onJump: () => void;
}) {
  return (
    <button
      onClick={onJump}
      className={`w-full text-left px-3 py-2 border-b border-border/50 transition-all duration-200 hover:bg-white/5 ${
        active ? "bg-cyan/10 border-l-2 border-l-cyan" : "border-l-2 border-l-transparent"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted w-4 shrink-0">{kindIcon[ev.kind] ?? "·"}</span>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sevDot[ev.severity] ?? "bg-muted"}`} />
        <span className="text-[11px] font-medium text-text/90 truncate flex-1">{ev.title}</span>
        <span className="font-mono text-[10px] text-muted shrink-0">{fmtClockS(ev.simSec)}</span>
      </div>
      <p className="text-[10px] text-muted mt-0.5 pl-6 leading-snug line-clamp-2">{ev.detail}</p>
    </button>
  );
}

export default function IncidentTimeline() {
  const timeline = useStore((s) => s.timeline);
  const simSec = useStore((s) => s.simSec);
  const jumpToTimelineEvent = useStore((s) => s.jumpToTimelineEvent);
  const mode = useStore((s) => s.mode);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current && timeline.length > 0) {
      listRef.current.scrollTop = 0;
    }
  }, [timeline[0]?.id]);

  return (
    <div className="panel flex flex-col shrink-0 max-h-[40vh] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="panel-header">Incident Timeline</span>
        <span className="tag text-muted">{timeline.length} events</span>
      </div>
      <div ref={listRef} className="flex-1 scroll-panel min-h-0">
        {timeline.length === 0 ? (
          <div className="p-4 text-center">
            <div className="text-xs text-muted mb-1">Network nominal</div>
            <div className="text-[10px] text-muted/70">
              {mode === "live"
                ? "Pipeline events appear here as the AI engine runs."
                : "Inject a disruption to populate the decision log."}
            </div>
          </div>
        ) : (
          timeline.map((ev) => (
            <EventRow
              key={ev.id}
              ev={ev}
              active={Math.abs(ev.simSec - simSec) < 30}
              onJump={() => jumpToTimelineEvent(ev)}
            />
          ))
        )}
      </div>
    </div>
  );
}
