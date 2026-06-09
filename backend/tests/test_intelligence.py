"""Tests for the real intelligence stack (OR-Tools, ML forecaster, multi-LLM verifier)."""
from railmind.config import build_orchestrator
from railmind.forecaster import GBMDelayForecaster
from railmind.optimizer_ortools import CpSatOptimizer
from railmind.verifier_llm import MultiModelVerifier
from pathlib import Path

CONFIG = Path(__file__).resolve().parent.parent / "config" / "mumbai_csmt_igatpuri.yaml"


def test_delay_forecaster_loads_and_forecasts(twin):
    from railmind.interfaces import SimContext
    from railmind.geo import parse_hhmm

    fc = GBMDelayForecaster()
    ctx = SimContext(sim_sec=parse_hhmm("09:40"))
    states = twin.compute_states(ctx)
    out = fc.forecast(twin, states, ctx)
    assert fc.kind in ("ml", "heuristic")
    assert isinstance(out, list)


def test_cp_sat_optimizer_produces_plan(twin):
    from railmind.detectors import RuleBasedConflictDetector
    from railmind.interfaces import SimContext
    from railmind.geo import parse_hhmm

    det = RuleBasedConflictDetector()
    opt = CpSatOptimizer()
    ctx = SimContext(sim_sec=parse_hhmm("09:40"))
    states = twin.compute_states(ctx)
    conflicts = det.detect(twin, ctx)
    assert conflicts
    plan = opt.propose(twin, conflicts[0], states)
    assert plan.actions
    assert "OR-Tools" in plan.summary or plan.delay_saved_min >= 2


def test_multi_model_verifier_fallback(twin):
    from railmind.detectors import RuleBasedConflictDetector
    from railmind.interfaces import SimContext
    from railmind.geo import parse_hhmm
    from railmind.optimizer import GreedyOptimizer

    det = RuleBasedConflictDetector()
    opt = GreedyOptimizer()
    ver = MultiModelVerifier()
    ctx = SimContext(sim_sec=parse_hhmm("09:40"))
    states = twin.compute_states(ctx)
    c = det.detect(twin, ctx)[0]
    plan = opt.propose(twin, c, states)
    result = ver.verify_full(twin, plan, c)
    assert result.total >= 1
    assert "Verified" in result.note or "Rule check" in result.note


def test_orchestrator_intelligence_pipeline():
    orch = build_orchestrator(CONFIG)
    assert type(orch.optimizer).__name__ == "CpSatOptimizer"
    orch.inject_block("KSRA-IGP")
    for _ in range(25):
        orch.step(0.2)
    snap = orch.snapshot()
    assert snap.engine_modules
    assert len(snap.engine_modules) == 8
    assert any(m.key == "optimizer" for m in snap.engine_modules)
    if snap.conflicts:
        assert snap.recommendations
        p = snap.recommendations[0]
        assert p.actions
        assert p.explanation
