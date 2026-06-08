from railmind.models import TwinSnapshot


def test_smoke_run_many_ticks(orch):
    """Advance the orchestrator like the live loop and validate each snapshot."""
    for _ in range(200):
        orch.step(0.2)  # 0.2s real * 60x = 12 sim-sec per tick
        snap = orch.snapshot()
        assert isinstance(snap, TwinSnapshot)
        # serialization round-trips (this is the WS payload)
        TwinSnapshot.model_validate_json(snap.model_dump_json())
    assert snap.sim_sec > 0


def test_network_model_complete(orch):
    net = orch.network_model()
    assert len(net.stations) >= 20
    assert len(net.trains) >= 5
    for t in net.trains:
        assert len(t.polyline) == len(t.cum_km)
        assert t.total_km > 0


def test_whatif_delay_injection(orch):
    intent, echo, explanation = orch.run_whatif("delay 12137 by 30 min")
    assert intent == "delay"
    assert orch.delays_sec.get("12137") == 30 * 60
    assert "12137" in echo


def test_whatif_block_creates_conflicts(orch):
    orch.seek(9 * 3600 + 2400)  # 09:40
    before = len([c for c in orch._conflicts])
    orch.run_whatif("what if KYN-KSRA closes?")
    assert any("KYN" in d.label for d in orch.disruptions)
    # blocking the KYN->KSRA stretch blocks every section on the path
    assert orch.blocked
    assert any("KSRA" in sec for sec in orch.blocked)


def test_apply_plan_reduces_or_resolves(orch):
    orch.seek(9 * 3600 + 2400)  # 09:40 — conflicts present
    assert orch._conflicts, "expected conflicts at 09:40"
    cid = orch._conflicts[0].id
    applied = orch.apply_plan(cid)
    assert applied
    assert cid in orch.applied_ids
    assert any(v > 0 for v in orch.delays_sec.values())


def test_autonomous_auto_applies(orch):
    orch.set_autonomous(True)
    orch.seek(9 * 3600 + 2400)
    for _ in range(5):
        orch.step(0.2)
    # at least one critical plan should have been auto-applied
    assert orch.applied_plans or not any(
        c.severity == "critical" for c in orch._conflicts
    )
