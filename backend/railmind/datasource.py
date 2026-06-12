"""DataSource implementations.

``GeoJSONDataSource`` reads real Indian-Railways-style GeoJSON (datameet/railways)
plus a data.gov.in-style timetable subset. A future ``LiveApiDataSource`` would
implement the same interface against an operational feed.
"""
from __future__ import annotations

import json
from pathlib import Path

from .geo import cumulative_arc_length, parse_hhmm
from .interfaces import DataSource, ScheduleStop, Section, Station, Train


class GeoJSONDataSource(DataSource):
    def __init__(self, stations_path: str, sections_path: str, timetable_path: str, base: Path):
        self.stations_path = base / stations_path
        self.sections_path = base / sections_path
        self.timetable_path = base / timetable_path

    def load_stations(self) -> list[Station]:
        gj = json.loads(self.stations_path.read_text())
        out = []
        for f in gj["features"]:
            p = f["properties"]
            lng, lat = f["geometry"]["coordinates"]
            out.append(
                Station(
                    code=p["code"],
                    name=p["name"],
                    lat=lat,
                    lng=lng,
                    platforms=int(p.get("platforms", 2)),
                )
            )
        return out

    def load_sections(self) -> list[Section]:
        gj = json.loads(self.sections_path.read_text())
        out = []
        for f in gj["features"]:
            p = f["properties"]
            geom = [(float(c[0]), float(c[1])) for c in f["geometry"]["coordinates"]]
            cum = cumulative_arc_length(geom)
            out.append(
                Section(
                    id=f"{p['from']}-{p['to']}",
                    frm=p["from"],
                    to=p["to"],
                    line=p["line"],
                    capacity=int(p["capacity"]),
                    ghat=bool(p.get("ghat", False)),
                    geometry=geom,
                    cum_km=cum,
                    length_km=cum[-1],
                )
            )
        return out

    def load_trains(
        self, stations: dict[str, Station], sections: dict[str, Section]
    ) -> list[Train]:
        tt = json.loads(self.timetable_path.read_text())
        trains: list[Train] = []
        for t in tt["trains"]:
            polyline, cum_dist = self._build_polyline(t["route"], stations, sections)
            poly_cum = cumulative_arc_length(polyline)
            schedule = [
                ScheduleStop(station=s["station"], arr=parse_hhmm(s["arr"]), dep=parse_hhmm(s["dep"]))
                for s in t["schedule"]
            ]
            trains.append(
                Train(
                    number=t["number"],
                    name=t["name"],
                    type=t["type"],
                    direction=t["direction"],
                    coaches=int(t["coaches"]),
                    capacity_pax=int(t["capacityPax"]),
                    route=t["route"],
                    schedule=schedule,
                    cum_dist_km=cum_dist,
                    polyline=polyline,
                    poly_cum_km=poly_cum,
                    total_km=poly_cum[-1],
                )
            )
        return trains

    @staticmethod
    def _hop_sections(
        frm: str, to: str, sections: dict[str, Section]
    ) -> list[Section] | None:
        """Sections covering one timetable hop, in travel order.

        Express routes can hop over stations that have no direct section
        (e.g. CSMT→DR skipping BY) — BFS the station/section graph so the
        train still follows real track instead of a straight-line shortcut.
        """
        direct = sections.get(f"{frm}-{to}") or sections.get(f"{to}-{frm}")
        if direct is not None:
            return [direct]
        adj: dict[str, list[tuple[str, Section]]] = {}
        for sec in sections.values():
            adj.setdefault(sec.frm, []).append((sec.to, sec))
            adj.setdefault(sec.to, []).append((sec.frm, sec))
        prev_hop: dict[str, tuple[str, Section]] = {}
        queue = [frm]
        seen = {frm}
        while queue:
            u = queue.pop(0)
            if u == to:
                chain: list[Section] = []
                while u != frm:
                    p, sec = prev_hop[u]
                    chain.append(sec)
                    u = p
                return chain[::-1]
            for v, sec in adj.get(u, []):
                if v not in seen:
                    seen.add(v)
                    prev_hop[v] = (u, sec)
                    queue.append(v)
        return None

    @classmethod
    def _build_polyline(
        cls, route: list[str], stations: dict[str, Station], sections: dict[str, Section]
    ) -> tuple[list[tuple[float, float]], list[float]]:
        polyline: list[tuple[float, float]] = []
        cum_dist: list[float] = []
        running = 0.0
        for i, code in enumerate(route):
            cum_dist.append(running)
            if i == 0:
                st = stations[code]
                polyline.append((st.lng, st.lat))
                continue
            prev = route[i - 1]
            chain = cls._hop_sections(prev, code, sections)
            if not chain:
                st = stations[code]
                polyline.append((st.lng, st.lat))
                continue
            at = prev
            for sec in chain:
                geom = sec.geometry if sec.frm == at else list(reversed(sec.geometry))
                for v in geom[1:]:
                    polyline.append(v)
                running += sec.length_km
                at = sec.to if sec.frm == at else sec.frm
            cum_dist[-1] = running
        return polyline, cum_dist
