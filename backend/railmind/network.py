"""NetworkGraph: stations=nodes, sections=edges on NetworkX.

Route geometries are stored as polylines with PRECOMPUTED ARC-LENGTH so motion
is smooth and speed is correct regardless of vertex spacing. Provides routing
helpers (alternate paths) the optimizer can later use for true reroutes.
"""
from __future__ import annotations

from typing import Optional

import networkx as nx

from .interfaces import DataSource, Section, Station, Train


class NetworkGraph:
    def __init__(self, source: DataSource):
        self.stations: dict[str, Station] = {s.code: s for s in source.load_stations()}
        sections = source.load_sections()
        self.sections: dict[str, Section] = {}
        for sec in sections:
            self.sections[sec.id] = sec
            self.sections[f"{sec.to}-{sec.frm}"] = sec  # reverse lookup
        self._section_list = sections
        self.trains: list[Train] = source.load_trains(self.stations, self.sections)

        self.graph = nx.Graph()
        for s in self.stations.values():
            self.graph.add_node(s.code, name=s.name, lat=s.lat, lng=s.lng, platforms=s.platforms)
        for sec in sections:
            self.graph.add_edge(
                sec.frm, sec.to, id=sec.id, length_km=sec.length_km,
                capacity=sec.capacity, line=sec.line, ghat=sec.ghat,
            )

    @property
    def section_list(self) -> list[Section]:
        return self._section_list

    def station(self, code: str) -> Optional[Station]:
        return self.stations.get(code)

    def section(self, sid: str) -> Optional[Section]:
        return self.sections.get(sid)

    def train(self, number: str) -> Optional[Train]:
        return next((t for t in self.trains if t.number == number), None)

    @staticmethod
    def canonical(section_id: str) -> str:
        a, b = section_id.split("-")
        return f"{a}-{b}" if a < b else f"{b}-{a}"

    def shortest_path(self, src: str, dst: str) -> list[str]:
        """Topological route between two stations (foundation for reroute)."""
        try:
            return nx.shortest_path(self.graph, src, dst, weight="length_km")
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            return []

    def alternate_paths(self, src: str, dst: str, k: int = 3) -> list[list[str]]:
        try:
            gen = nx.shortest_simple_paths(self.graph, src, dst, weight="length_km")
            return [next(gen) for _ in range(k)]
        except (StopIteration, nx.NetworkXNoPath, nx.NodeNotFound):
            return []
