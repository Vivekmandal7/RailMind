"""Invariants for the committed section geometry (coarse or OSM-traced).

These guard the stitching contract that both the backend
(``GeoJSONDataSource._build_polyline``) and the frontend
(``stitchRoutePolyline``) rely on:

* every section's first/last vertex sits ON its from/to station coordinate;
* arc length is strictly monotonic (no zero-length segments);
* shape is sane: length >= straight-line distance, sinuosity bounded;
* every timetable hop resolves to a section (either direction);
* the frontend's bundled copies are byte-identical to the backend's.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
FRONTEND_DATA = BACKEND.parent / "frontend" / "data"

CORRIDORS = {
    "delhi": ("delhi_stations.geojson", "delhi_sections.geojson", "delhi_timetable.json"),
    "mumbai": ("stations.geojson", "sections.geojson", "timetable.json"),
    "india": ("india_stations.geojson", "india_sections.geojson", "india_timetable.json"),
}

_R = 6371000.0


def haversine_m(a, b) -> float:
    lon1, lat1 = math.radians(a[0]), math.radians(a[1])
    lon2, lat2 = math.radians(b[0]), math.radians(b[1])
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * _R * math.asin(min(1.0, math.sqrt(h)))


def load(corridor: str):
    st_name, sec_name, tt_name = CORRIDORS[corridor]
    stations = json.loads((BACKEND / "data" / st_name).read_text())
    sections = json.loads((BACKEND / "data" / sec_name).read_text())
    timetable = json.loads((BACKEND / "data" / tt_name).read_text())
    st_pt = {
        f["properties"]["code"]: tuple(f["geometry"]["coordinates"])
        for f in stations["features"]
    }
    return st_pt, sections["features"], timetable


@pytest.mark.parametrize("corridor", list(CORRIDORS))
def test_section_endpoints_sit_on_stations(corridor):
    st_pt, sections, _ = load(corridor)
    for f in sections:
        p = f["properties"]
        coords = f["geometry"]["coordinates"]
        assert p["from"] in st_pt, f"{corridor}: unknown from-station {p['from']}"
        assert p["to"] in st_pt, f"{corridor}: unknown to-station {p['to']}"
        d_from = haversine_m(coords[0], st_pt[p["from"]])
        d_to = haversine_m(coords[-1], st_pt[p["to"]])
        assert d_from <= 1.0, (
            f"{corridor} {p['from']}-{p['to']}: first vertex {d_from:.1f} m off from-station"
        )
        assert d_to <= 1.0, (
            f"{corridor} {p['from']}-{p['to']}: last vertex {d_to:.1f} m off to-station"
        )


@pytest.mark.parametrize("corridor", list(CORRIDORS))
def test_section_arc_length_strictly_monotonic(corridor):
    _, sections, _ = load(corridor)
    for f in sections:
        p = f["properties"]
        coords = f["geometry"]["coordinates"]
        assert len(coords) >= 2
        for i in range(1, len(coords)):
            seg = haversine_m(coords[i - 1], coords[i])
            assert seg > 0, (
                f"{corridor} {p['from']}-{p['to']}: duplicate vertex at index {i}"
            )


@pytest.mark.parametrize("corridor", list(CORRIDORS))
def test_section_shape_sane(corridor):
    st_pt, sections, _ = load(corridor)
    for f in sections:
        p = f["properties"]
        coords = f["geometry"]["coordinates"]
        length = sum(haversine_m(coords[i - 1], coords[i]) for i in range(1, len(coords)))
        straight = haversine_m(st_pt[p["from"]], st_pt[p["to"]])
        assert straight > 0
        sinuosity = length / straight
        max_sin = 3.0 if p.get("ghat") else 2.5
        assert 0.99 <= sinuosity <= max_sin, (
            f"{corridor} {p['from']}-{p['to']}: sinuosity {sinuosity:.2f} "
            f"outside [0.99, {max_sin}] (len {length / 1000:.1f} km, "
            f"straight {straight / 1000:.1f} km)"
        )


@pytest.mark.parametrize("corridor", list(CORRIDORS))
def test_every_timetable_hop_resolves_through_sections(corridor):
    """Each hop must have a direct section OR a path through the section
    graph (the loaders BFS-expand skipped-station hops onto real track)."""
    _, sections, timetable = load(corridor)
    adj: dict[str, set[str]] = {}
    for f in sections:
        p = f["properties"]
        adj.setdefault(p["from"], set()).add(p["to"])
        adj.setdefault(p["to"], set()).add(p["from"])

    def connected(a: str, b: str) -> bool:
        queue, seen = [a], {a}
        while queue:
            u = queue.pop()
            if u == b:
                return True
            for v in adj.get(u, ()):
                if v not in seen:
                    seen.add(v)
                    queue.append(v)
        return False

    for t in timetable["trains"]:
        route = t["route"]
        for a, b in zip(route, route[1:]):
            assert connected(a, b), (
                f"{corridor} train {t['number']}: hop {a}-{b} unreachable "
                f"through the section graph (would render as a straight line)"
            )


@pytest.mark.parametrize(
    "name",
    [n for c in CORRIDORS.values() for n in c if (FRONTEND_DATA / n).exists()],
)
def test_frontend_copy_byte_identical(name):
    backend_bytes = (BACKEND / "data" / name).read_bytes()
    frontend_bytes = (FRONTEND_DATA / name).read_bytes()
    assert backend_bytes == frontend_bytes, (
        f"{name}: frontend/data copy differs from backend/data — "
        f"re-run scripts/build_osm_geometry.py (it writes both)"
    )
