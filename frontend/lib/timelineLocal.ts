import type { Conflict, Disruption, ResolutionPlan, TimelineEvent } from "./types";

let seq = 0;

function uid(): string {
  seq += 1;
  return `loc-${seq}-${Date.now().toString(36)}`;
}

/** Rolling local audit log when the Python engine is offline. */
export class LocalTimelineTracker {
  private events: TimelineEvent[] = [];
  private seen = new Set<string>();
  private prevConflictIds = new Set<string>();
  private prevPlanKeys = new Set<string>();
  private hadConflicts = false;

  push(
    kind: string,
    title: string,
    detail: string,
    opts: { severity?: string; simSec: number; refId?: string; dedupeKey?: string } = {
      simSec: 0
    }
  ): void {
    if (opts.dedupeKey && this.seen.has(opts.dedupeKey)) return;
    if (opts.dedupeKey) this.seen.add(opts.dedupeKey);
    this.events.unshift({
      id: uid(),
      kind,
      title,
      detail,
      severity: opts.severity ?? "info",
      simSec: opts.simSec,
      refId: opts.refId,
      wallMs: Date.now()
    });
    this.events = this.events.slice(0, 80);
  }

  sync(input: {
    simSec: number;
    conflicts: Conflict[];
    plans: ResolutionPlan[];
    disruptions: Disruption[];
    resolvedConflictIds: Set<string>;
  }): TimelineEvent[] {
    const curIds = new Set(input.conflicts.map((c) => c.id));
    for (const c of input.conflicts) {
      if (!this.prevConflictIds.has(c.id)) {
        this.push("conflict", `Conflict detected · ${c.type}`, c.message, {
          severity: c.severity,
          simSec: input.simSec,
          refId: c.id,
          dedupeKey: `conflict:${c.id}`
        });
      }
    }
    this.prevConflictIds = curIds;

    for (const p of input.plans) {
      const pk = `plan:${p.id}`;
      if (!this.prevPlanKeys.has(pk)) {
        const acts = p.actions
          .slice(0, 3)
          .map((a) => `${a.kind} ${a.train}`)
          .join("; ");
        this.push("optimize", "Resolution plan generated", `${p.delaySavedMin}m saved · ${acts}`, {
          severity: "info",
          simSec: input.simSec,
          refId: p.id,
          dedupeKey: pk
        });
        this.push(
          "verify",
          p.verified ? "Verified ✓" : "Flagged for review",
          p.verifyNote.slice(0, 120),
          {
            severity: p.flaggedForHuman ? "warning" : p.verified ? "safe" : "critical",
            simSec: input.simSec,
            refId: p.conflictId,
            dedupeKey: `verify:${p.conflictId}:${p.verified}`
          }
        );
        this.prevPlanKeys.add(pk);
      }
    }

    if (input.conflicts.length > 0) this.hadConflicts = true;
    if (this.hadConflicts && input.conflicts.length === 0 && input.disruptions.length === 0) {
      this.push("outcome", "Network nominal", "Conflicts cleared · KPIs recovering", {
        severity: "safe",
        simSec: input.simSec,
        dedupeKey: `outcome:${Math.floor(input.simSec)}`
      });
      this.hadConflicts = false;
    }

    return this.events;
  }

  clear(simSec: number): TimelineEvent[] {
    this.events = [];
    this.seen.clear();
    this.prevConflictIds.clear();
    this.prevPlanKeys.clear();
    this.hadConflicts = false;
    this.push("clear", "Disruptions cleared", "Network returning to plan", {
      severity: "safe",
      simSec
    });
    return this.events;
  }

  snapshot(): TimelineEvent[] {
    return this.events;
  }
}

export const localTimeline = new LocalTimelineTracker();
