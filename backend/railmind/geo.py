"""Geodesy + arc-length helpers.

Arc-length parameterization is the foundation of smooth motion: positions are
addressed by distance travelled (km), not by vertex index, so visual speed is
correct regardless of how densely the polyline is sampled.
"""
from __future__ import annotations

import math

LngLat = tuple[float, float]
_R = 6371.0  # km


def haversine_km(a: LngLat, b: LngLat) -> float:
    lon1, lat1 = math.radians(a[0]), math.radians(a[1])
    lon2, lat2 = math.radians(b[0]), math.radians(b[1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * _R * math.asin(min(1.0, math.sqrt(h)))


def cumulative_arc_length(coords: list[LngLat]) -> list[float]:
    """Precomputed cumulative arc-length (km) at each vertex."""
    cum = [0.0]
    for i in range(1, len(coords)):
        cum.append(cum[-1] + haversine_km(coords[i - 1], coords[i]))
    return cum


def bearing_deg(a: LngLat, b: LngLat) -> float:
    lon1, lat1 = math.radians(a[0]), math.radians(a[1])
    lon2, lat2 = math.radians(b[0]), math.radians(b[1])
    dlon = lon2 - lon1
    y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return math.degrees(math.atan2(y, x))


def interpolate_along(coords: list[LngLat], cum: list[float], d: float) -> tuple[LngLat, float]:
    """Position + heading at distance ``d`` km along an arc-length polyline."""
    if d <= 0:
        nxt = coords[1] if len(coords) > 1 else coords[0]
        return coords[0], bearing_deg(coords[0], nxt)
    total = cum[-1]
    if d >= total:
        prev = coords[-2] if len(coords) > 1 else coords[-1]
        return coords[-1], bearing_deg(prev, coords[-1])
    # locate segment
    lo, hi = 0, len(cum) - 1
    while lo < hi - 1:
        mid = (lo + hi) // 2
        if cum[mid] <= d:
            lo = mid
        else:
            hi = mid
    seg_start, seg_end = cum[lo], cum[lo + 1]
    t = 0.0 if seg_end == seg_start else (d - seg_start) / (seg_end - seg_start)
    a, b = coords[lo], coords[lo + 1]
    pos = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    return pos, bearing_deg(a, b)


def smootherstep(x: float) -> float:
    """Ken Perlin's smootherstep: zero 1st & 2nd derivative at the ends.

    Used as the distance-vs-time easing between two stops, giving smooth
    acceleration out of a station and deceleration into the next one.
    """
    x = max(0.0, min(1.0, x))
    return x * x * x * (x * (x * 6 - 15) + 10)


def smootherstep_deriv(x: float) -> float:
    """d/dx smootherstep — proportional to instantaneous speed along a segment."""
    x = max(0.0, min(1.0, x))
    return 30 * x * x * (x - 1) * (x - 1)


def parse_hhmm(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 3600 + int(m) * 60
