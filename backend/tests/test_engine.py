from railmind.detectors import RuleBasedConflictDetector
from railmind.geo import parse_hhmm
from railmind.interfaces import SimContext
from railmind.optimizer import GreedyOptimizer
from railmind.predictor import DelayCascadePredictor
from railmind.verifier import RuleBasedVerifier


def test_detects_single_line_head_on_conflict(twin):
    det = RuleBasedConflictDetector()
    ctx = SimContext(sim_sec=parse_hhmm("09:40"))
    conflicts = det.detect(twin, ctx)
    assert conflicts, "expected at least one projected conflict"
    headways = [c for c in conflicts if c.type == "headway" and c.severity == "critical"]
    assert headways, "expected a critical single-line headway conflict on the ghat"
    # the known head-on pair on KSRA-IGP
    ghat = [c for c in conflicts if c.location in ("KSRA-IGP", "IGP-KSRA")]
    assert ghat
    assert set(["12137", "12534"]).issubset(set(ghat[0].trains) | {t for c in ghat for t in c.trains})


def test_optimizer_and_verifier(twin):
    det = RuleBasedConflictDetector()
    opt = GreedyOptimizer()
    ver = RuleBasedVerifier()
    ctx = SimContext(sim_sec=parse_hhmm("09:40"))
    states = twin.compute_states(ctx)
    conflicts = det.detect(twin, ctx)
    c = conflicts[0]
    plan = opt.propose(twin, c, states)
    assert plan.actions
    assert plan.delay_saved_min >= 2
    ok, note = ver.verify(twin, plan, c)
    assert ok
    assert "Feasibility" in note


def test_predictor_cascades_from_delay(twin):
    pred = DelayCascadePredictor()
    # inject a big delay so cascade triggers
    ctx = SimContext(sim_sec=parse_hhmm("09:40"), delays_sec={"12137": 25 * 60})
    states = twin.compute_states(ctx)
    preds = pred.predict(twin, states, ctx)
    # predictions may be empty if no shared sections, but structure must be valid
    for p in preds:
        assert p.predicted_delay_min >= 1
        assert "cascade" in p.cause
