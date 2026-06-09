"""Multi-LLM consensus verifier — Claude + GPT judge plan safety/feasibility."""
from __future__ import annotations

import time
from dataclasses import dataclass

from . import llm
from .interfaces import Conflict, DigitalTwinProto, ResolutionPlan, Verifier, VerifierVote
from .verifier import RuleBasedVerifier


@dataclass
class VerifyResult:
    verified: bool
    note: str
    agree: int
    total: int
    flagged: bool


class MultiModelVerifier(Verifier):
    """Rule-based gate + up to two independent LLM judges."""

    def __init__(self, min_headway_sec: int = 240):
        self.base = RuleBasedVerifier(min_headway_sec=min_headway_sec)

    def verify(
        self, twin: DigitalTwinProto, plan: ResolutionPlan, conflict: Conflict
    ) -> tuple[bool, str]:
        result = self.verify_full(twin, plan, conflict)
        return result.verified, result.note

    def verify_full(
        self, twin: DigitalTwinProto, plan: ResolutionPlan, conflict: Conflict
    ) -> VerifyResult:
        t0 = time.perf_counter()
        ok, base_note = self.base.verify(twin, plan, conflict)
        if not ok:
            return VerifyResult(
                verified=False,
                note=f"Rule check failed: {base_note}",
                agree=0, total=0, flagged=True,
            )

        providers = llm.available_providers()[:2]
        if not providers:
            ms = int((time.perf_counter() - t0) * 1000)
            return VerifyResult(
                verified=True,
                note=(
                    f"Verified ✓ rule-based ({ms}ms). {base_note} "
                    "(No LLM keys — set ANTHROPIC_API_KEY / OPENAI_API_KEY for multi-model consensus.)"
                ),
                agree=1, total=1, flagged=False,
            )

        votes: list[VerifierVote] = []
        prompt = self._prompt(plan, conflict)
        system = (
            "You are a railway traffic controller safety reviewer. "
            "Judge whether the proposed resolution plan is safe and feasible. "
            'Reply ONLY with JSON: {"verdict":"approve"|"reject"|"flag","note":"one sentence"}'
        )
        for p in providers:
            data = llm.complete_json(p, system, prompt, timeout=10.0, max_tokens=256)
            if data and data.get("verdict") in ("approve", "reject", "flag"):
                votes.append(VerifierVote(
                    model=p.label, verdict=data["verdict"], note=str(data.get("note", ""))[:200],
                ))
            else:
                txt = llm.complete(p, system, prompt, timeout=10.0, max_tokens=256)
                verdict = "approve" if txt and "approve" in txt.lower() else "flag"
                votes.append(VerifierVote(
                    model=p.label, verdict=verdict,
                    note=(txt or "No response")[:200],
                ))

        approve = sum(1 for v in votes if v.verdict == "approve")
        reject = sum(1 for v in votes if v.verdict == "reject")
        total = len(votes)
        flagged = reject > 0 or any(v.verdict == "flag" for v in votes if approve < total)
        verified = approve == total and total > 0 and reject == 0

        rationales = " · ".join(f"{v.model}: {v.note[:80]}" for v in votes)
        ms = int((time.perf_counter() - t0) * 1000)
        if verified:
            note = f"Verified ✓ {approve}/{total} models agree ({ms}ms). {rationales}"
        elif flagged:
            note = f"Flagged for human review — {approve}/{total} approve ({ms}ms). {rationales}"
        else:
            note = f"Not verified — {approve}/{total} approve ({ms}ms). {rationales}"

        return VerifyResult(verified=verified, note=note, agree=approve, total=total, flagged=flagged)

    @staticmethod
    def _prompt(plan: ResolutionPlan, conflict: Conflict) -> str:
        acts = "; ".join(f"{a.kind} {a.train}: {a.detail}" for a in plan.actions)
        return (
            f"Conflict: {conflict.type} at {conflict.location_label} — {conflict.message}\n"
            f"Trains involved: {', '.join(conflict.trains)}\n"
            f"Proposed plan: {plan.summary}\n"
            f"Actions: {acts}\n"
            f"Expected: {plan.delay_saved_min} min saved, {plan.passengers_protected} pax protected.\n"
            "Is this plan safe and operationally feasible?"
        )
