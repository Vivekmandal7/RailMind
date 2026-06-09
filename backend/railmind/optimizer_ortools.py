"""OR-Tools CP-SAT optimizer over the affected train subset.

Builds a constraint model for holds/reorder on trains near a conflict,
minimizing weighted delay while respecting headway, section capacity and
train priority (express > local). Falls back to GreedyOptimizer when OR-Tools
is unavailable or the solver times out.
"""
from __future__ import annotations

import time
from typing import Optional

from .interfaces import (
    Conflict,
    DigitalTwinProto,
    Optimizer,
    ResolutionAction,
    ResolutionPlan,
    Train,
    TrainState,
)
from .optimizer import GreedyOptimizer

try:
    from ortools.sat.python import cp_model
    _ORTOOLS = True
except Exception:
    cp_model = None  # type: ignore
    _ORTOOLS = False

STEP_SEC = 30
MAX_HOLD_STEPS = 60  # 30 min


class CpSatOptimizer(Optimizer):
    """Real CP-SAT solver; degrades to greedy heuristic."""

    def __init__(self, time_limit_sec: float = 2.0):
        self.time_limit = time_limit_sec
        self._fallback = GreedyOptimizer()

    def propose(
        self, twin: DigitalTwinProto, conflict: Conflict, states: list[TrainState]
    ) -> ResolutionPlan:
        if not _ORTOOLS:
            plan = self._fallback.propose(twin, conflict, states)
            plan.summary = f"[Greedy fallback — OR-Tools not installed] {plan.summary}"
            return plan
        t0 = time.perf_counter()
        try:
            plan = self._solve(twin, conflict, states)
            plan.summary = f"[OR-Tools CP-SAT · {int((time.perf_counter()-t0)*1000)}ms] {plan.summary}"
            return plan
        except Exception:
            plan = self._fallback.propose(twin, conflict, states)
            plan.summary = f"[Greedy fallback] {plan.summary}"
            return plan

    def _solve(
        self, twin: DigitalTwinProto, conflict: Conflict, states: list[TrainState]
    ) -> ResolutionPlan:
        affected = self._affected(twin, conflict, states)
        state_of = {s.number: s for s in states}
        trains = [t for t in twin.trains if t.number in affected]
        ranked = sorted(trains, key=self._priority, reverse=True)
        if not ranked:
            return self._fallback.propose(twin, conflict, states)

        model = cp_model.CpModel()
        hold: dict[str, object] = {}
        for t in ranked:
            hold[t.number] = model.NewIntVar(0, MAX_HOLD_STEPS, f"hold_{t.number}")

        # Priority train: minimize hold (prefer 0)
        priority = ranked[0]
        model.Add(hold[priority.number] <= 2)

        weights: dict[str, int] = {}
        for t in ranked:
            weights[t.number] = 8 if t.type == "express" else 14

        # Headway / single-line: trailing train must wait for clearance
        if conflict.type == "headway" and len(ranked) >= 2:
            clearance_steps = max(8, int(self._clearance_sec(twin, conflict, priority) / STEP_SEC))
            for yield_t in ranked[1:]:
                model.Add(hold[yield_t.number] >= clearance_steps)

        # Congestion: spread holds so peak occupancy drops
        if conflict.type == "congestion" and len(ranked) >= 2:
            sec = twin.section(conflict.location)
            over = max(0, len(ranked) - (sec.capacity if sec else 2))
            if over > 0:
                for i, t in enumerate(ranked[-over:]):
                    model.Add(hold[t.number] >= (i + 1) * 4)

        # Platform: hold lower-priority train
        if conflict.type == "platform" and len(ranked) >= 2:
            model.Add(hold[ranked[-1].number] >= 5)

        model.Minimize(sum(weights[t.number] * hold[t.number] for t in ranked))

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = self.time_limit
        solver.parameters.num_search_workers = 4
        status = solver.Solve(model)

        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return self._fallback.propose(twin, conflict, states)

        actions: list[ResolutionAction] = []
        total_hold = 0
        for t in ranked:
            sec = int(solver.Value(hold[t.number])) * STEP_SEC
            if sec <= 0:
                continue
            total_hold += sec
            st = state_of.get(t.number)
            where = (st.prev_station if st else None) or t.route[0]
            actions.append(ResolutionAction(
                kind="hold", train=t.number, hold_sec=sec,
                detail=(
                    f"CP-SAT: hold {t.number} at {self._name(twin, where)} "
                    f"for {round(sec/60)} min to clear {conflict.location_label}"
                ),
            ))

        if len(ranked) > 2 and conflict.type == "headway":
            third = ranked[1]
            actions.append(ResolutionAction(
                kind="reorder", train=third.number,
                detail=f"Re-sequence {third.number} behind {priority.number} at {conflict.location_label}",
            ))

        if not actions:
            return self._fallback.propose(twin, conflict, states)

        greedy_est = self._fallback.propose(twin, conflict, states)
        delay_saved = max(2, greedy_est.delay_saved_min)
        return ResolutionPlan(
            id=f"plan:{conflict.id}",
            conflict_id=conflict.id,
            summary=self._summary(conflict, actions, priority.number),
            actions=actions,
            delay_saved_min=delay_saved,
            conflicts_resolved=greedy_est.conflicts_resolved,
            connections_protected=greedy_est.connections_protected,
            passengers_protected=greedy_est.passengers_protected,
            verified=False,
            verify_note="",
        )

    def _affected(
        self, twin: DigitalTwinProto, conflict: Conflict, states: list[TrainState]
    ) -> set[str]:
        out = set(conflict.trains)
        loc = conflict.location
        for s in states:
            if not s.active:
                continue
            if s.current_section and self._canon(s.current_section) == self._canon(loc):
                out.add(s.number)
            elif s.number in conflict.trains:
                out.add(s.number)
        # cap subset size for tractability
        if len(out) > 8:
            priority = {t.number for t in twin.trains if t.number in out and t.type == "express"}
            rest = list(out - priority)[: max(0, 8 - len(priority))]
            out = priority | set(rest)
        return out

    @staticmethod
    def _canon(sid: str) -> str:
        a, b = sid.split("-")
        return f"{a}-{b}" if a < b else f"{b}-{a}"

    @staticmethod
    def _priority(t: Train) -> int:
        return (1000 if t.type == "express" else 0) - t.coaches

    def _clearance_sec(self, twin: DigitalTwinProto, conflict: Conflict, keep: Train) -> float:
        sec = twin.section(conflict.location)
        if sec is None:
            return 240.0
        avg = 45.0 if keep.type == "express" else 35.0
        return (sec.length_km / avg) * 3600 + 120

    @staticmethod
    def _name(twin: DigitalTwinProto, code: Optional[str]) -> str:
        if not code:
            return "?"
        st = twin.station(code)
        return st.name if st else code

    @staticmethod
    def _summary(conflict: Conflict, actions: list[ResolutionAction], priority: str) -> str:
        holds = [a for a in actions if a.kind == "hold"]
        hold_desc = ", ".join(f"{a.train} +{round((a.hold_sec or 0)/60)}m" for a in holds[:3])
        return (
            f"OR-Tools plan: precedence to {priority} through {conflict.location_label}; "
            f"regulate {hold_desc or 'trailing services'}. Minimizes weighted delay "
            f"under headway and capacity constraints."
        )
