"""Plain-language plan explainer — LLM with rule-based fallback."""
from __future__ import annotations

import time
from typing import Optional

from . import llm
from .interfaces import Conflict, Explainer, PassengerImpact, PlanExplanation, ResolutionPlan


class LLMExplainer(Explainer):
    def explain(
        self, plan: ResolutionPlan, conflict: Conflict,
        impact: Optional[PassengerImpact] = None,
    ) -> PlanExplanation:
        t0 = time.perf_counter()
        providers = llm.available_providers()
        if providers:
            p = providers[0]
            system = (
                "You are a railway control-room advisor. Explain the resolution plan "
                "in 2-3 crisp sentences for an operator. No bullet points."
            )
            user = (
                f"Conflict: {conflict.message}\n"
                f"Plan: {plan.summary}\n"
                f"Actions: {'; '.join(a.detail for a in plan.actions)}\n"
                f"Impact: saves ~{plan.delay_saved_min} min, protects "
                f"{plan.passengers_protected:,} passengers, "
                f"{plan.connections_protected} connections."
            )
            txt = llm.complete(p, system, user, timeout=10.0, max_tokens=300, temperature=0.2)
            if txt:
                ms = int((time.perf_counter() - t0) * 1000)
                return PlanExplanation(
                    plan_id=plan.id, text=txt.strip(),
                    model=f"{p.label} ({ms}ms)",
                )
        return PlanExplanation(
            plan_id=plan.id,
            text=self._rule_based(plan, conflict),
            model="rule-based",
        )

    @staticmethod
    def _rule_based(plan: ResolutionPlan, conflict: Conflict) -> str:
        acts = plan.actions
        hold = next((a for a in acts if a.kind == "hold"), None)
        if conflict.type == "headway":
            return (
                f"Holding {hold.train if hold else 'trailing services'} creates safe "
                f"headway through {conflict.location_label}, preventing a head-on conflict "
                f"while keeping {plan.passengers_protected:,} passengers on schedule."
            )
        if conflict.type == "congestion":
            return (
                f"Staggering entry into {conflict.location_label} reduces occupancy below "
                f"section capacity, saving an estimated {plan.delay_saved_min} minutes network-wide."
            )
        return (
            f"Re-platforming at {conflict.location_label} resolves the clash with minimal "
            f"knock-on delay to downstream connections."
        )
