from railmind.interfaces import SimContext
from railmind.geo import parse_hhmm


def ctx(hhmm: str) -> SimContext:
    return SimContext(sim_sec=parse_hhmm(hhmm))


def test_train_scheduled_before_departure(twin):
    states = {s.number: s for s in twin.compute_states(ctx("07:30"))}
    s = states["12137"]  # Punjab Mail departs CSMT 08:00
    assert not s.active
    assert s.status == "scheduled"


def test_train_running_and_positioned(twin):
    states = {s.number: s for s in twin.compute_states(ctx("08:20"))}
    s = states["12137"]
    assert s.active
    assert s.dist_km > 0
    assert s.speed_kmh > 0
    # position is a real lng/lat on the corridor
    assert 72 < s.position[0] < 74
    assert 18 < s.position[1] < 20


def test_motion_is_continuous_no_teleport(twin):
    """Distance must advance smoothly between fine time steps (no jumps)."""
    prev = None
    sec = parse_hhmm("08:01")
    end = parse_hhmm("08:34")
    max_jump = 0.0
    while sec < end:
        s = next(x for x in twin.compute_states(SimContext(sim_sec=sec)) if x.number == "12137")
        if prev is not None:
            jump = abs(s.dist_km - prev)
            max_jump = max(max_jump, jump)
        prev = s.dist_km
        sec += 5
    # over a 5s step the train should move less than ~0.3 km (i.e. < 216 km/h)
    assert max_jump < 0.35


def test_accelerates_from_station_and_brakes_into_next(twin):
    """Speed near a stop should be lower than mid-segment (ease-in/out)."""
    # 12137: CSMT dep 08:00, DR arr 08:12. Sample just-after-dep, mid, just-before-arr.
    just_after = next(x for x in twin.compute_states(ctx("08:01")) if x.number == "12137")
    mid = next(x for x in twin.compute_states(ctx("08:06")) if x.number == "12137")
    just_before = next(x for x in twin.compute_states(ctx("08:11")) if x.number == "12137")
    assert mid.speed_kmh > just_after.speed_kmh
    assert mid.speed_kmh > just_before.speed_kmh


def test_arrives_after_schedule_end(twin):
    states = {s.number: s for s in twin.compute_states(ctx("11:30"))}
    s = states["12137"]  # arrives IGP 10:45
    assert s.status == "arrived"
    assert not s.active
