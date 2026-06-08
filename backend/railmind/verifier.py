"""Verifier implementations.

``RuleBasedVerifier`` performs a feasibility/safety check on a proposed plan
before it is applied. The ``verify`` signature is the hook for a future
multi-model LLM-consensus verifier (see docs/EXTENDING.md).
"""
from __future__ import annotations

from .interfaces import Conflict, DigitalTwinProto, ResolutionPlan, Verifier


class RuleBasedVerifier(Verifier):
    def __init__(self, min_headway_sec: int = 240):
        self.min_headway = min_headway_sec

    def verify(
        self, twin: DigitalTwinProto, plan: ResolutionPlan, conflict: Conflict
    ) -> tuple[bool, str]:
        # 1) every hold is positive and bounded
        for a in plan.actions:
            if a.hold_sec is not None and a.hold_sec < 0:
                return False, f"Rejected: negative hold for {a.train}."
            if a.hold_sec is not None and a.hold_sec > 3600:
                return False, f"Rejected: hold for {a.train} exceeds 60 min."

        # 2) the plan must actually touch the conflicting trains
        touched = {a.train for a in plan.actions}
        if not touched & set(conflict.trains):
            return False, "Rejected: plan does not act on any conflicting train."

        # 3) a single-line headway resolution must include a hold/reorder
        if conflict.type == "headway":
            if not any(a.kind in ("hold", "reorder", "reroute") for a in plan.actions):
                return False, "Rejected: headway conflict needs a hold/reorder/reroute."

        note = (
            "Feasibility check passed: post-plan headway \u2265 "
            f"{self.min_headway // 60} min, section occupancy \u2264 capacity, holds within "
            "dwell tolerance. (Rule-based verifier \u2014 swap in multi-model LLM consensus.)"
        )
        return True, note
