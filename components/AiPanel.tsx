"use client";
import { useStore } from "@/store/useStore";
import type { ResolutionPlan, Conflict } from "@/lib/types";

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex flex-col items-center px-2 py-1.5 rounded-lg bg-base/60 border border-border flex-1">
      <span className={`font-mono text-base ${tone}`}>{value}</span>
      <span className="panel-header text-[9px] mt-0.5 text-center">{label}</span>
    </div>
  );
}

function PlanCard({ plan, conflict }: { plan: ResolutionPlan; conflict?: Conflict }) {
  const applyPlan = useStore((s) => s.applyPlan);
  const scrub = useStore((s) => s.scrub);
  const setTrack = useStore((s) => s.setTrack);
  const applied = useStore((s) => s.appliedPlans.some((p) => p.conflictId === plan.conflictId));

  return (
    <div className="rounded-xl border border-border bg-panel2 p-3 mb-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span
            className={`tag font-semibold ${
              conflict?.severity === "critical"
                ? "text-risk border-risk/50 bg-risk/10"
                : "text-amber border-amber/50 bg-amber/10"
            }`}
          >
            {conflict?.type?.toUpperCase() ?? "RISK"}
          </span>
          <span className="text-[11px] text-muted font-mono">{conflict?.locationLabel}</span>
        </div>
        {plan.verified && (
          <span className="tag text-safe border-safe/50 bg-safe/10 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-safe" /> VERIFIED
          </span>
        )}
      </div>

      <p className="text-xs text-text/90 leading-snug mb-2">{plan.summary}</p>

      <div className="space-y-1 mb-2.5">
        {plan.actions.map((a, i) => (
          <div key={i} className="flex items-start gap-2 text-[11px]">
            <span className="tag text-cyan border-cyan/40 bg-cyan/10 uppercase">{a.kind}</span>
            <span className="text-muted leading-snug">{a.detail}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-1.5 mb-2.5">
        <Stat label="Delay saved" value={`${plan.delaySavedMin}m`} tone="text-safe" />
        <Stat label="Conflicts" value={`${plan.conflictsResolved}`} tone="text-cyan" />
        <Stat label="Pax protected" value={plan.passengersProtected.toLocaleString()} tone="text-amber" />
        <Stat label="Connections" value={`${plan.connectionsProtected}`} tone="text-text" />
      </div>

      <div className="text-[10px] text-muted/80 italic mb-2.5 leading-snug">{plan.verifyNote}</div>

      <div className="flex gap-2">
        <button
          disabled={applied}
          onClick={() => applyPlan(plan)}
          className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-colors ${
            applied
              ? "bg-safe/15 text-safe border border-safe/40 cursor-default"
              : "bg-amber text-base hover:brightness-110"
          }`}
        >
          {applied ? "Applied" : "Apply Plan"}
        </button>
        <button
          onClick={() => {
            if (conflict) scrub(conflict.atSec - 90);
            if (conflict?.trains[0]) setTrack(conflict.trains[0]);
          }}
          className="flex-1 text-xs font-semibold py-1.5 rounded-lg border border-cyan/50 text-cyan hover:bg-cyan/10 transition-colors"
        >
          Simulate
        </button>
      </div>
    </div>
  );
}

export default function AiPanel() {
  const conflicts = useStore((s) => s.conflicts);
  const plans = useStore((s) => s.plans);
  const autonomous = useStore((s) => s.autonomous);
  const setAutonomous = useStore((s) => s.setAutonomous);
  const appliedPlans = useStore((s) => s.appliedPlans);

  return (
    <div className="panel flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <span className="panel-header">AI Recommendations</span>
        <button
          onClick={() => setAutonomous(!autonomous)}
          className={`flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-lg border transition-colors ${
            autonomous
              ? "border-amber/60 bg-amber/15 text-amber"
              : "border-border text-muted hover:text-text"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${autonomous ? "bg-amber shadow-glowAmber" : "bg-muted"}`}
          />
          AUTO
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5">
        {plans.length === 0 && (
          <div className="text-xs text-muted p-2">
            No active conflicts. The optimizer is monitoring the look-ahead window
            (45 min) for headway, platform and congestion risks.
          </div>
        )}
        {plans.map((p) => (
          <PlanCard key={p.id} plan={p} conflict={conflicts.find((c) => c.id === p.conflictId)} />
        ))}

        {appliedPlans.length > 0 && (
          <div className="mt-2">
            <div className="panel-header mb-1.5">Applied · Action Log</div>
            {appliedPlans.map((p, i) => (
              <div
                key={`${p.id}-${i}`}
                className="text-[11px] text-muted border-l-2 border-safe/40 pl-2 py-1 mb-1"
              >
                <span className="text-safe font-mono">+{p.delaySavedMin}m saved</span> ·{" "}
                {p.summary.slice(0, 80)}…
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
