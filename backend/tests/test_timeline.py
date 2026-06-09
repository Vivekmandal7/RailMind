"""Timeline log unit tests."""
from railmind.timeline import TimelineLog


def test_timeline_push_and_dedupe():
    log = TimelineLog(max_len=10)
    ev = log.push("inject", "Block", "KSRA-IGP", severity="critical", sim_sec=100.0, dedupe_key="x")
    assert ev is not None
    assert log.push("inject", "Block", "dup", severity="critical", sim_sec=100.0, dedupe_key="x") is None
    snap = log.snapshot()
    assert len(snap) == 1
    assert snap[0].kind == "inject"


def test_timeline_clear():
    log = TimelineLog()
    log.push("conflict", "Headway", "msg", sim_sec=1.0)
    log.clear()
    assert log.snapshot() == []
