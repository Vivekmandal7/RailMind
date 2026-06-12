"""Build high-fidelity railway section geometry from OpenStreetMap.

Replaces the coarse hand-drawn section polylines (~3 vertices per section)
with the *real* track alignment, fetched once from the Overpass API and
committed to the repo — never a runtime dependency.

For every existing section (from-station → to-station) we:
  1. fetch all `railway=rail` ways (no `service` tag → mainlines only) in a
     padded bbox around the section, caching raw responses on disk;
  2. build an undirected node-shared graph of those ways;
  3. run Dijkstra from the node nearest the from-station to the node nearest
     the to-station — the shortest path naturally follows one running line
     through parallel-track territory;
  4. snap the path's endpoints to the corridor's EXACT station coordinates
     (both the backend's `_build_polyline` and the frontend's
     `stitchRoutePolyline` orient/stitch sections by their endpoints);
  5. simplify with Douglas–Peucker (10 m for corridors, 150 m for the
     india-wide network whose geojson is statically bundled in the frontend);
  6. sanity-check (length vs straight-line sinuosity) and emit the identical
     GeoJSON schema with `from/to/line/capacity/ghat` preserved.

On any per-section failure (no OSM coverage, no path, weird sinuosity) the
old coarse geometry is kept and a loud warning printed.

Usage:
  python scripts/build_osm_geometry.py delhi
  python scripts/build_osm_geometry.py mumbai india
  python scripts/build_osm_geometry.py --all --dry-run
"""
from __future__ import annotations

import argparse
import heapq
import json
import math
import sys
import time
from pathlib import Path

import httpx

BACKEND = Path(__file__).resolve().parent.parent
FRONTEND_DATA = BACKEND.parent / "frontend" / "data"
CACHE_DIR = Path(__file__).resolve().parent / ".overpass_cache"

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

# overpass-api.de's Apache 406s requests without a meaningful User-Agent.
HTTP_HEADERS = {"User-Agent": "RailMind-geometry-builder/1.0 (one-time offline build)"}

# corridor key -> file set + Douglas-Peucker tolerance + whether the frontend
# bundles a copy that must stay byte-identical.
CORRIDORS: dict[str, dict] = {
    "delhi": {
        "stations": "data/delhi_stations.geojson",
        "sections": "data/delhi_sections.geojson",
        "tolerance_m": 10.0,
        "coord_decimals": 6,
        "frontend_copy": False,
        "bbox_pad_deg": 0.25,
    },
    "mumbai": {
        "stations": "data/stations.geojson",
        "sections": "data/sections.geojson",
        "tolerance_m": 10.0,
        "coord_decimals": 6,
        "frontend_copy": True,
        "bbox_pad_deg": 0.25,
    },
    "india": {
        "stations": "data/india_stations.geojson",
        "sections": "data/india_sections.geojson",
        "tolerance_m": 150.0,
        "coord_decimals": 5,
        "frontend_copy": True,
        "bbox_pad_deg": 0.35,
        # india sections span hundreds of km diagonally — an axis-aligned bbox
        # would pull ALL rail in a ~400×500 km rectangle. A thin oriented
        # corridor polygon along the from→to line keeps queries sane.
        "use_poly": True,
        # 300+ km hauls cross genuinely unmapped OSM stretches; bridge them —
        # the result renders behind 150 m simplification at national zoom.
        "bridge_m": 400.0,
    },
}

_R = 6371000.0  # m


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1 = math.radians(a[0]), math.radians(a[1])
    lon2, lat2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * _R * math.asin(min(1.0, math.sqrt(h)))


def polyline_len_m(coords: list[tuple[float, float]]) -> float:
    return sum(haversine_m(coords[i - 1], coords[i]) for i in range(1, len(coords)))


# ---------------------------------------------------------------- Overpass --

def overpass_query(bbox: tuple[float, float, float, float]) -> str:
    """south,west,north,east bbox → mainline rail ways (+ crossovers) with nodes.

    Crossovers are included for CONNECTIVITY only — without them the up and
    down lines of a double-track route are disjoint graph components and no
    path exists between stations whose nearest nodes land on different lines.
    Sidings/yards/spurs stay excluded so Dijkstra can't shortcut through them.
    """
    s, w, n, e = bbox
    box = f"({s:.4f},{w:.4f},{n:.4f},{e:.4f})"
    return (
        f"[out:json][timeout:180];"
        f'(way["railway"="rail"][!"service"]{box};'
        f'way["railway"="rail"]["service"="crossover"]{box};);'
        f"(._;>;);out body;"
    )


CACHE_VERSION = "v2"  # bump when overpass_query changes — invalidates old caches


def corridor_poly(
    from_pt: tuple[float, float], to_pt: tuple[float, float], buffer_deg: float
) -> str:
    """Overpass `poly` filter: a buffered rectangle oriented along from→to."""
    lat0 = math.radians((from_pt[1] + to_pt[1]) / 2)
    kx = max(0.2, math.cos(lat0))  # degree-space lon compression
    dx = (to_pt[0] - from_pt[0]) * kx
    dy = to_pt[1] - from_pt[1]
    length = math.hypot(dx, dy) or 1e-9
    ux, uy = dx / length, dy / length
    px, py = -uy, ux
    b = buffer_deg
    corners = [
        (from_pt[0] + (-ux * b + px * b) / kx, from_pt[1] + (-uy * b + py * b)),
        (from_pt[0] + (-ux * b - px * b) / kx, from_pt[1] + (-uy * b - py * b)),
        (to_pt[0] + (ux * b - px * b) / kx, to_pt[1] + (uy * b - py * b)),
        (to_pt[0] + (ux * b + px * b) / kx, to_pt[1] + (uy * b + py * b)),
    ]
    return " ".join(f"{lat:.4f} {lon:.4f}" for lon, lat in corners)


def overpass_query_poly(poly: str) -> str:
    return (
        f"[out:json][timeout:300];"
        f'(way["railway"="rail"][!"service"](poly:"{poly}");'
        f'way["railway"="rail"]["service"="crossover"](poly:"{poly}"););'
        f"(._;>;);out body;"
    )


def fetch_rail_ways(section_id: str, query: str) -> dict:
    """Cached Overpass fetch for one section query."""
    CACHE_DIR.mkdir(exist_ok=True)
    cache = CACHE_DIR / f"{CACHE_VERSION}_{section_id.replace('/', '_')}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    last_err: Exception | None = None
    for attempt in range(4):
        endpoint = OVERPASS_ENDPOINTS[attempt % len(OVERPASS_ENDPOINTS)]
        try:
            resp = httpx.post(endpoint, data={"data": query}, timeout=240.0, headers=HTTP_HEADERS)
            if resp.status_code in (429, 504):
                wait = 12.0 * (attempt + 1)
                print(f"    overpass busy ({resp.status_code}), retrying in {wait:.0f}s…")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            payload = resp.json()
            cache.write_text(json.dumps(payload))
            time.sleep(1.5)  # be polite between fresh requests
            return payload
        except Exception as exc:  # noqa: BLE001 — retry then surface
            last_err = exc
            time.sleep(6.0 * (attempt + 1))
    raise RuntimeError(f"Overpass failed for {section_id}: {last_err}")


# ------------------------------------------------------------------- graph --

def build_graph(
    *payloads: dict,
    bridge_m: float | None = None,
) -> tuple[dict[int, tuple[float, float]], dict[int, list[tuple[int, float]]]]:
    nodes: dict[int, tuple[float, float]] = {}
    for payload in payloads:
        for el in payload.get("elements", []):
            if el.get("type") == "node":
                nodes[el["id"]] = (el["lon"], el["lat"])
    adj: dict[int, list[tuple[int, float]]] = {}
    way_endpoints: set[int] = set()
    for payload in payloads:
        for el in payload.get("elements", []):
            if el.get("type") != "way":
                continue
            nds = [n for n in el.get("nodes", []) if n in nodes]
            for a, b in zip(nds, nds[1:]):
                w = haversine_m(nodes[a], nodes[b])
                adj.setdefault(a, []).append((b, w))
                adj.setdefault(b, []).append((a, w))
            if nds:
                way_endpoints.add(nds[0])
                way_endpoints.add(nds[-1])
    _bridge_gaps(nodes, adj, way_endpoints, bridge_m or _BRIDGE_M)
    return nodes, adj


_BRIDGE_M = 30.0


def _bridge_gaps(
    nodes: dict[int, tuple[float, float]],
    adj: dict[int, list[tuple[int, float]]],
    way_endpoints: set[int],
    bridge_m: float,
) -> None:
    """Connect way ENDPOINTS within `bridge_m` of each other.

    OSM rail frequently has hairline gaps (two ways meant to join but drawn
    with distinct nearby nodes, often at station boundaries). Left unbridged,
    the mainline shatters into components and pathfinding falls onto the
    wrong parallel line. The default 30 m endpoint-to-endpoint bridge is
    physically a track joint, never a shortcut; the india-wide network uses
    a larger bridge because 300+ km hauls cross genuinely unmapped stretches
    and the result is drawn behind 150 m simplification at national zoom.
    """
    # spatial hash sized to the bridge radius so this stays O(k) for k endpoints
    cell = max(0.0003, bridge_m / 100000.0)
    grid: dict[tuple[int, int], list[int]] = {}
    for nid in way_endpoints:
        lon, lat = nodes[nid]
        grid.setdefault((int(lon / cell), int(lat / cell)), []).append(nid)
    existing = {(a, b) for a, nbrs in adj.items() for b, _ in nbrs}
    for nid in way_endpoints:
        lon, lat = nodes[nid]
        ci, cj = int(lon / cell), int(lat / cell)
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for other in grid.get((ci + di, cj + dj), ()):
                    if other <= nid or (nid, other) in existing:
                        continue
                    d = haversine_m(nodes[nid], nodes[other])
                    if 0 < d <= bridge_m:
                        adj.setdefault(nid, []).append((other, d))
                        adj.setdefault(other, []).append((nid, d))


def connected_components(adj: dict[int, list[tuple[int, float]]]) -> list[list[int]]:
    seen: set[int] = set()
    comps: list[list[int]] = []
    for start in adj:
        if start in seen:
            continue
        comp = [start]
        seen.add(start)
        stack = [start]
        while stack:
            u = stack.pop()
            for v, _ in adj[u]:
                if v not in seen:
                    seen.add(v)
                    comp.append(v)
                    stack.append(v)
        comps.append(comp)
    return comps


def pick_endpoints(
    nodes: dict[int, tuple[float, float]],
    adj: dict[int, list[tuple[int, float]]],
    from_pt: tuple[float, float],
    to_pt: tuple[float, float],
) -> tuple[int, int, float, float] | None:
    """Endpoint nodes guaranteed to lie on the SAME connected component.

    OSM rail around big stations fragments into parallel components (passenger
    lines, freight corridors, loops). Independently-nearest nodes can land on
    different components — then no path exists, or a wild detour wins. So:
    per component, take its closest node to each station; pick the component
    whose worse endpoint distance is smallest.
    """
    best: tuple[float, int, int, float, float] | None = None
    for comp in connected_components(adj):
        if len(comp) < 10:  # stub fragments can't carry a section
            continue
        da, na = min((haversine_m(nodes[n], from_pt), n) for n in comp)
        db, nb = min((haversine_m(nodes[n], to_pt), n) for n in comp)
        score = max(da, db)
        if best is None or score < best[0]:
            best = (score, na, nb, da, db)
    if best is None:
        return None
    _, na, nb, da, db = best
    return na, nb, da, db


def dijkstra(
    adj: dict[int, list[tuple[int, float]]], start: int, goal: int
) -> list[int] | None:
    dist: dict[int, float] = {start: 0.0}
    prev: dict[int, int] = {}
    pq: list[tuple[float, int]] = [(0.0, start)]
    seen: set[int] = set()
    while pq:
        d, u = heapq.heappop(pq)
        if u in seen:
            continue
        seen.add(u)
        if u == goal:
            path = [u]
            while u in prev:
                u = prev[u]
                path.append(u)
            return path[::-1]
        for v, w in adj.get(u, []):
            nd = d + w
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))
    return None


# ------------------------------------------------------------ station snap --

def _project_to_segment(
    pt: tuple[float, float], a: tuple[float, float], b: tuple[float, float]
) -> tuple[tuple[float, float], float]:
    """Nearest point on segment a-b to pt, in lon/lat — local-metre projection."""
    lat0 = math.radians(pt[1])
    kx = math.cos(lat0) * 111320.0
    ky = 110540.0
    ax, ay = a[0] * kx, a[1] * ky
    bx, by = b[0] * kx, b[1] * ky
    px, py = pt[0] * kx, pt[1] * ky
    dx, dy = bx - ax, by - ay
    seg2 = dx * dx + dy * dy
    t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
    qx, qy = ax + t * dx, ay + t * dy
    d = math.hypot(px - qx, py - qy)
    return (qx / kx, qy / ky), d


def snap_stations(
    st_pt: dict[str, tuple[float, float]],
    nodes: dict[int, tuple[float, float]],
    adj: dict[int, list[tuple[int, float]]],
) -> dict[str, tuple[float, float]]:
    """Move each station coordinate onto the corridor's real running line.

    The committed station coords are hand-placed and can sit >1 km off the
    track, which both drags section endpoints off the railway and makes
    endpoint-picking fall onto the wrong parallel line (e.g. the freight
    corridor). We pick the ONE component that best serves ALL stations (the
    passenger mainline by construction — a bypass line scores worse at the
    stations it skips), then project each station onto its nearest edge.
    """
    comps = [c for c in connected_components(adj) if len(c) >= 30]
    if not comps:
        return dict(st_pt)

    def comp_score(comp: list[int]) -> float:
        comp_set = set(comp)
        total = 0.0
        for pt in st_pt.values():
            d = min(haversine_m(nodes[n], pt) for n in comp_set)
            total += min(d, 2500.0)
        return total

    main = min(comps, key=comp_score)
    main_set = set(main)

    snapped: dict[str, tuple[float, float]] = {}
    for code, pt in st_pt.items():
        # nearest node first (cheap), then refine on that node's edges
        nd, nid = min((haversine_m(nodes[n], pt), n) for n in main_set)
        best_pt, best_d = nodes[nid], nd
        seen_pairs: set[tuple[int, int]] = set()
        frontier = [nid]
        for _ in range(3):  # widen a few hops — the true nearest edge is local
            nxt: list[int] = []
            for u in frontier:
                for v, _w in adj.get(u, []):
                    if v not in main_set:
                        continue
                    pair = (min(u, v), max(u, v))
                    if pair in seen_pairs:
                        continue
                    seen_pairs.add(pair)
                    q, d = _project_to_segment(pt, nodes[u], nodes[v])
                    if d < best_d:
                        best_pt, best_d = q, d
                    nxt.append(v)
            frontier = nxt
        # Generous cap: rural station coords are hand-placed up to ~4 km off
        # the (only) line; the mainline-component restriction prevents
        # snapping onto a wrong parallel railway.
        if best_d > 5000.0:
            print(f"    !! station {code}: {best_d:.0f} m from mainline — keeping original coord")
            snapped[code] = pt
        else:
            snapped[code] = (round(best_pt[0], 6), round(best_pt[1], 6))
    return snapped


# ---------------------------------------------------------------- simplify --

def douglas_peucker(coords: list[tuple[float, float]], tolerance_m: float) -> list[tuple[float, float]]:
    if len(coords) <= 2:
        return coords
    # local equirectangular projection (metres) — plenty accurate at section scale
    lat0 = math.radians(sum(c[1] for c in coords) / len(coords))
    kx = math.cos(lat0) * 111320.0
    ky = 110540.0
    pts = [(c[0] * kx, c[1] * ky) for c in coords]

    keep = [False] * len(coords)
    keep[0] = keep[-1] = True
    stack = [(0, len(coords) - 1)]
    while stack:
        i0, i1 = stack.pop()
        ax, ay = pts[i0]
        bx, by = pts[i1]
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        worst, worst_d2 = -1, tolerance_m * tolerance_m
        for i in range(i0 + 1, i1):
            px, py = pts[i]
            if seg2 == 0:
                d2 = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
                qx, qy = ax + t * dx, ay + t * dy
                d2 = (px - qx) ** 2 + (py - qy) ** 2
            if d2 > worst_d2:
                worst, worst_d2 = i, d2
        if worst >= 0:
            keep[worst] = True
            stack.append((i0, worst))
            stack.append((worst, i1))
    return [c for c, k in zip(coords, keep) if k]


# ------------------------------------------------------------------- build --

def section_query(
    from_pt: tuple[float, float],
    to_pt: tuple[float, float],
    pad_deg: float,
    use_poly: bool,
) -> str:
    if use_poly:
        return overpass_query_poly(corridor_poly(from_pt, to_pt, pad_deg))
    s = min(from_pt[1], to_pt[1]) - pad_deg
    n = max(from_pt[1], to_pt[1]) + pad_deg
    w = min(from_pt[0], to_pt[0]) - pad_deg
    e = max(from_pt[0], to_pt[0]) + pad_deg
    return overpass_query((s, w, n, e))


def trace_section(
    sec_id: str,
    payload: dict,
    from_pt: tuple[float, float],
    to_pt: tuple[float, float],
    bridge_m: float | None = None,
) -> list[tuple[float, float]] | None:
    """Real OSM path from from_pt to to_pt, endpoints snapped to the stations."""
    nodes, adj = build_graph(payload, bridge_m=bridge_m)
    if not adj:
        print(f"    !! {sec_id}: no rail ways in bbox")
        return None

    picked = pick_endpoints(nodes, adj, from_pt, to_pt)
    if picked is None:
        print(f"    !! {sec_id}: no usable rail component in bbox")
        return None
    a, b, da, db = picked
    if da > 3000 or db > 3000:
        print(f"    !! {sec_id}: stations too far from track (from {da:.0f} m, to {db:.0f} m)")
        return None

    path = dijkstra(adj, a, b)
    if not path or len(path) < 2:
        print(f"    !! {sec_id}: no continuous OSM track between endpoints")
        return None

    coords = [nodes[nid] for nid in path]
    # Snap endpoints to the corridor's exact station coordinates — the
    # backend/frontend stitching contract keys on section endpoints.
    if haversine_m(coords[0], from_pt) > 2.0:
        coords.insert(0, from_pt)
    else:
        coords[0] = from_pt
    if haversine_m(coords[-1], to_pt) > 2.0:
        coords.append(to_pt)
    else:
        coords[-1] = to_pt
    return coords


def build_corridor(key: str, dry_run: bool) -> None:
    cfg = CORRIDORS[key]
    stations_path = BACKEND / cfg["stations"]
    sections_path = BACKEND / cfg["sections"]
    stations_gj = json.loads(stations_path.read_text())
    sections_gj = json.loads(sections_path.read_text())

    st_pt: dict[str, tuple[float, float]] = {
        f["properties"]["code"]: tuple(f["geometry"]["coordinates"])
        for f in stations_gj["features"]
    }

    print(f"\n=== {key}: {len(sections_gj['features'])} sections "
          f"(DP tolerance {cfg['tolerance_m']:.0f} m) ===")

    # Pass 1 — fetch all section payloads (cached on disk after first run).
    payloads: dict[str, dict] = {}
    for f in sections_gj["features"]:
        p = f["properties"]
        sec_id = f"{key}_{p['from']}-{p['to']}"
        from_pt, to_pt = st_pt.get(p["from"]), st_pt.get(p["to"])
        if not from_pt or not to_pt:
            print(f"    !! {sec_id}: unknown station code")
            continue
        try:
            payloads[sec_id] = fetch_rail_ways(
                sec_id,
                section_query(from_pt, to_pt, cfg["bbox_pad_deg"], cfg.get("use_poly", False)),
            )
        except RuntimeError as exc:
            print(f"    !! {exc}")

    # Pass 2 — snap station coords onto the corridor's real running line.
    # Hand-placed station coords sit up to ~1.4 km off the track; snapping
    # fixes section endpoints AND map station dots in one move.
    merged_nodes, merged_adj = build_graph(*payloads.values(), bridge_m=cfg.get("bridge_m"))
    snapped = snap_stations(st_pt, merged_nodes, merged_adj) if merged_adj else dict(st_pt)
    moved = {
        code: haversine_m(st_pt[code], snapped[code])
        for code in st_pt
        if haversine_m(st_pt[code], snapped[code]) > 1.0
    }
    if moved:
        worst = max(moved.values())
        print(f"  snapped {len(moved)}/{len(st_pt)} stations onto the line "
              f"(max move {worst:.0f} m)")
    st_pt = snapped

    # Pass 3 — trace each section between the snapped endpoints.
    upgraded = 0
    report: list[str] = []
    for f in sections_gj["features"]:
        p = f["properties"]
        sec_id = f"{key}_{p['from']}-{p['to']}"
        old = [tuple(c) for c in f["geometry"]["coordinates"]]
        from_pt, to_pt = st_pt.get(p["from"]), st_pt.get(p["to"])
        if not from_pt or not to_pt or sec_id not in payloads:
            report.append(f"  {p['from']:>5}–{p['to']:<5} KEPT OLD ({len(old)} verts)")
            continue

        traced = trace_section(
            sec_id, payloads[sec_id], from_pt, to_pt, bridge_m=cfg.get("bridge_m")
        )
        if traced is None and cfg.get("use_poly"):
            # Real route may bow far outside the thin corridor band (e.g.
            # HWH–NJP arcs east) — retry once with a much wider band.
            try:
                wide = fetch_rail_ways(
                    f"{sec_id}_wide",
                    section_query(from_pt, to_pt, cfg["bbox_pad_deg"] * 2.5, True),
                )
                traced = trace_section(
                    f"{sec_id}_wide", wide, from_pt, to_pt, bridge_m=cfg.get("bridge_m")
                )
            except RuntimeError as exc:
                print(f"    !! {exc}")
        if traced is None:
            report.append(f"  {p['from']:>5}–{p['to']:<5} KEPT OLD ({len(old)} verts)")
            continue

        simplified = douglas_peucker(traced, cfg["tolerance_m"])
        straight = haversine_m(from_pt, to_pt)
        length = polyline_len_m(simplified)
        sinuosity = length / straight if straight > 0 else 1.0
        max_sin = 3.0 if p.get("ghat") else 2.5
        if not (0.99 <= sinuosity <= max_sin):
            print(f"    !! {sec_id}: sinuosity {sinuosity:.2f} outside [1.0,{max_sin}] — keeping old")
            report.append(f"  {p['from']:>5}–{p['to']:<5} KEPT OLD (sinuosity {sinuosity:.2f})")
            continue

        dec = cfg["coord_decimals"]
        coords = [[round(c[0], dec), round(c[1], dec)] for c in simplified]
        # endpoint snap survives rounding only if station coords already fit
        coords[0] = list(from_pt)
        coords[-1] = list(to_pt)
        f["geometry"]["coordinates"] = coords
        upgraded += 1
        report.append(
            f"  {p['from']:>5}–{p['to']:<5} {len(old):>3} → {len(coords):>4} verts · "
            f"{length / 1000:7.1f} km · sinuosity {sinuosity:.3f}"
            + ("  [ghat]" if p.get("ghat") else "")
        )

    # Stations may have moved (snap) — every section's endpoints must sit on
    # the FINAL station coords, including sections that kept old geometry.
    for f in sections_gj["features"]:
        p = f["properties"]
        from_pt, to_pt = st_pt.get(p["from"]), st_pt.get(p["to"])
        if not from_pt or not to_pt:
            continue
        coords = f["geometry"]["coordinates"]
        coords[0] = list(from_pt)
        coords[-1] = list(to_pt)

    print("\n".join(report))
    print(f"  upgraded {upgraded}/{len(sections_gj['features'])} sections")

    if dry_run:
        print("  (dry run — nothing written)")
        return

    for f in stations_gj["features"]:
        code = f["properties"]["code"]
        if code in st_pt:
            f["geometry"]["coordinates"] = list(st_pt[code])

    written: list[str] = []
    for gj, path in ((sections_gj, sections_path), (stations_gj, stations_path)):
        out = json.dumps(gj, separators=(",", ":")) + "\n"
        path.write_text(out)
        written.append(f"{path.relative_to(BACKEND.parent)} ({len(out) / 1024:.0f} KB)")
        if cfg["frontend_copy"]:
            fe = FRONTEND_DATA / path.name
            if fe.exists():
                fe.write_text(out)
                written.append(str(fe.relative_to(BACKEND.parent)))
    print(f"  wrote {' · '.join(written)}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("corridors", nargs="*", help="which corridors (delhi/mumbai/india)")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    keys = list(CORRIDORS) if args.all else args.corridors
    if not keys:
        ap.error("pick corridors (delhi/mumbai/india) or --all")
    bad = [k for k in keys if k not in CORRIDORS]
    if bad:
        ap.error(f"unknown corridor(s): {', '.join(bad)}")
    for key in keys:
        build_corridor(key, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
