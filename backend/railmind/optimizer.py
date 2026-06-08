"""Optimizer implementations.

``GreedyOptimizer`` resolves a conflict with a priority heuristic
(express > local), choosing hold / reorder / reroute and quantifying impact.
The ``propose`` signature is stable so an OR-Tools CP-SAT solver can replace it
without touching transport or UI (see docs/EXTENDING.md).
"""
from __future__ import annotations

from .interfaces import (
    Conflict,
    DigitalTwinProto,
    Optimizer,
    ResolutionAction,
    ResolutionPlan,
    TrainState,
    Train,
)


class GreedyOptimizer(Optimizer):
    def propose(
        self, twin: DigitalTwinProto, conflict: Conflict, states: list[TrainState]
    ) -> ResolutionPlan:
        trains = [t for t in twin.trains if t.number in conflict.trains]
        state_of = {s.number: s for s in states}
        ranked = sorted(trains, key=self._priority, reverse=True)
        keep = ranked[0]
        yield_train = ranked[-1]

        actions: list[ResolutionAction] = []
        conflicts_resolved = 1

        if conflict.type == "headway":
            clear = self._clearance_sec(twin, conflict, keep)
            hold = max(120, round(clear))
            ys = state_of.get(yield_train.number)
            where = (ys.prev_station if ys else None) or yield_train.route[0]
            actions.append(ResolutionAction(
                kind="hold", train=yield_train.number, hold_sec=hold,
                detail=(f"Hold {yield_train.number} at {self._name(twin, where)} for "
                        f"{round(hold/60)} min to clear {keep.number} through "
                        f"{conflict.location_label}"),
            ))
            delay_saved = self._cascade(conflict) - round(hold / 60)
            if len(trains) > 2:
                conflicts_resolved = 2
                third = ranked[1]
                ts = state_of.get(third.number)
                actions.append(ResolutionAction(
                    kind="reorder", train=third.number,
                    detail=(f"Re-sequence {third.number} behind {keep.number} at "
                            f"{self._name(twin, (ts.prev_station if ts else None) or third.route[0])}"),
                ))
        elif conflict.type == "congestion":
            actions.append(ResolutionAction(
                kind="hold", train=yield_train.number, hold_sec=180,
                detail=f"Meter {yield_train.number} for 3 min to relieve {conflict.location_label}",
            ))
            actions.append(ResolutionAction(
                kind="speed", train=keep.number,
                detail=f"Hold green for {keep.number} to flush the section",
            ))
            delay_saved = self._cascade(conflict) - 3
        else:  # platform
            actions.append(ResolutionAction(
                kind="reorder", train=yield_train.number, hold_sec=150,
                detail=f"Re-platform {yield_train.number} at {conflict.location_label}; hold 2.5 min",
            ))
            delay_saved = self._cascade(conflict) - 2

        delay_saved = max(2, round(delay_saved))
        connections = max(1, conflict.connections_at_risk - 1)
        pax_protected = round(conflict.passengers_affected * 0.78)

        return ResolutionPlan(
            id=f"plan:{conflict.id}",
            conflict_id=conflict.id,
            summary=self._summary(conflict, actions),
            actions=actions,
            delay_saved_min=delay_saved,
            conflicts_resolved=conflicts_resolved,
            connections_protected=connections,
            passengers_protected=pax_protected,
            verified=False,        # filled by the Verifier in the orchestrator
            verify_note="",
        )

    @staticmethod
    def _priority(t: Train) -> int:
        return (1000 if t.type == "express" else 0) - t.coaches

    def _clearance_sec(self, twin: DigitalTwinProto, conflict: Conflict, keep: Train) -> float:
        sec = twin.section(conflict.location)
        if sec is None:
            return 240
        avg = 45 if keep.type == "express" else 35
        return (sec.length_km / avg) * 3600 + 120

    @staticmethod
    def _cascade(conflict: Conflict) -> float:
        base = {"headway": 22, "platform": 12}.get(conflict.type, 9)
        return base + min(12, conflict.passengers_affected / 800)

    @staticmethod
    def _name(twin: DigitalTwinProto, code: str) -> str:
        st = twin.station(code)
        return st.name if st else code

    @staticmethod
    def _summary(conflict: Conflict, actions: list[ResolutionAction]) -> str:
        if conflict.type == "headway":
            hold = next((a for a in actions if a.kind == "hold"), None)
            tail = (f"hold {hold.train} {round((hold.hold_sec or 0)/60)} min"
                    if hold else "regulate trailing services")
            return (f"Precedence plan: give {conflict.trains[0]} the road through "
                    f"{conflict.location_label}; {tail}. No head-on conflict; throughput preserved.")
        if conflict.type == "congestion":
            return (f"Metering plan: stagger entry into {conflict.location_label} to keep "
                    f"occupancy within capacity.")
        return f"Platform plan: re-allocate platforms at {conflict.location_label}."
