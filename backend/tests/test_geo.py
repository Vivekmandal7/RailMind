import math

from railmind.geo import (
    cumulative_arc_length,
    haversine_km,
    interpolate_along,
    smootherstep,
    smootherstep_deriv,
)


def test_haversine_known_distance():
    # CSMT -> Dadar is roughly 9 km
    d = haversine_km((72.8355, 18.9398), (72.8434, 19.0186))
    assert 7 < d < 11


def test_cumulative_arc_length_monotonic():
    coords = [(0, 0), (0, 1), (0, 2), (0, 3)]
    cum = cumulative_arc_length(coords)
    assert cum[0] == 0
    assert all(cum[i] < cum[i + 1] for i in range(len(cum) - 1))


def test_interpolate_endpoints_and_midpoint():
    coords = [(0.0, 0.0), (0.0, 1.0)]
    cum = cumulative_arc_length(coords)
    pos0, _ = interpolate_along(coords, cum, 0)
    posN, _ = interpolate_along(coords, cum, cum[-1])
    mid, _ = interpolate_along(coords, cum, cum[-1] / 2)
    assert pos0 == (0.0, 0.0)
    assert abs(posN[1] - 1.0) < 1e-9
    assert 0.4 < mid[1] < 0.6  # halfway by arc-length


def test_smootherstep_zero_velocity_at_ends():
    assert smootherstep(0) == 0
    assert abs(smootherstep(1) - 1) < 1e-9
    assert smootherstep_deriv(0) == 0          # accelerate from rest
    assert abs(smootherstep_deriv(1)) < 1e-9   # brake to rest
    assert smootherstep_deriv(0.5) > 0         # moving mid-segment


def test_smootherstep_monotonic():
    xs = [i / 50 for i in range(51)]
    ys = [smootherstep(x) for x in xs]
    assert all(ys[i] <= ys[i + 1] + 1e-12 for i in range(len(ys) - 1))
