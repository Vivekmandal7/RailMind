"""DigitalTwin: holds train states and advances accelerated sim time.

Motion model (why it looks real):
  * Position is addressed by ARC-LENGTH along the real route polyline.
  * Between two scheduled stops, distance follows a *smootherstep* easing of
    time, so velocity is zero at each stop and peaks mid-segment — i.e. trains
    accelerate out of a station and brake into the next, never teleport.
  * Pass-through stations (not in the sparse schedule) are crossed at speed;
    easing only pins velocity to zero at genuine stops.
"""
from __future__ import annotations

from typing import Optional

from .geo import interpolate_along, smootherstep, smootherstep_deriv
from .interfaces import (
    DigitalTwinProto,
    SimContext,
    Station,
    Section,
    Train,
    TrainState,
)
from .network import NetworkGraph


def est_passengers(train: Train) -> int:
    factor = 1.6 if train.type == "local" else 0.82
    return round(train.capacity_pax * factor)


class DigitalTwin(DigitalTwinProto):
    def __init__(self, net: NetworkGraph, station_dwell_min_sec: int = 30):
        self.net = net
        self.dwell_min = station_dwell_min_sec
        self._stop_cache: dict[str, list[tuple[float, int, int]]] = {}

    # ---- DigitalTwinProto surface ---------------------------------------- #
    @property
    def trains(self) -> list[Train]:
        return self.net.trains

    def station(self, code: str) -> Optional[Station]:
        return self.net.station(code)

    def section(self, sid: str) -> Optional[Section]:
        return self.net.section(sid)

    def compute_states(self, ctx: SimContext) -> list[TrainState]:
        return [self.compute_train_state(t, ctx) for t in self.net.trains]

    # ---- kinematics ------------------------------------------------------ #
    def _stops(self, train: Train) -> list[tuple[float, int, int]]:
        cached = self._stop_cache.get(train.number)
        if cached is not None:
            return cached
        idx = {c: i for i, c in enumerate(train.route)}
        stops = [(train.cum_dist_km[idx[s.station]], s.arr, s.dep) for s in train.schedule]
        self._stop_cache[train.number] = stops
        return stops

    @staticmethod
    def _distance_at_time(stops: list[tuple[float, int, int]], te: float) -> float:
        if te <= stops[0][2]:
            return stops[0][0]
        if te >= stops[-1][1]:
            return stops[-1][0]
        for i in range(len(stops) - 1):
            d0, arr0, dep0 = stops[i]
            d1, arr1, dep1 = stops[i + 1]
            if arr0 <= te <= dep0:
                return d0  # dwell
            if dep0 < te < arr1:
                frac = (te - dep0) / max(1, (arr1 - dep0))
                return d0 + (d1 - d0) * smootherstep(frac)
        return stops[-1][0]

    @staticmethod
    def _speed_kmh(stops: list[tuple[float, int, int]], te: float) -> float:
        if te <= stops[0][2] or te >= stops[-1][1]:
            return 0.0
        for i in range(len(stops) - 1):
            d0, arr0, dep0 = stops[i]
            d1, arr1, dep1 = stops[i + 1]
            if arr0 <= te <= dep0:
                return 0.0
            if dep0 < te < arr1:
                frac = (te - dep0) / max(1, (arr1 - dep0))
                seg_km = d1 - d0
                seg_sec = max(1, arr1 - dep0)
                return max(0.0, (seg_km / seg_sec) * smootherstep_deriv(frac) * 3600)
        return 0.0

    @staticmethod
    def _time_at_distance(stops: list[tuple[float, int, int]], d: float) -> int:
        if d <= stops[0][0]:
            return stops[0][2]
        if d >= stops[-1][0]:
            return stops[-1][1]
        for i in range(len(stops) - 1):
            d0, arr0, dep0 = stops[i]
            d1, arr1, dep1 = stops[i + 1]
            if d0 <= d <= d1:
                frac = (d - d0) / max(1e-6, (d1 - d0))
                return int(dep0 + (arr1 - dep0) * frac)
        return stops[-1][1]

    def _fog_delay(self, train: Train, ctx: SimContext) -> float:
        if ctx.speed_factor >= 1:
            return 0.0
        stops = self._stops(train)
        journey = stops[-1][1] - stops[0][2]
        return journey * (1 / ctx.speed_factor - 1) * 0.5

    def compute_train_state(self, train: Train, ctx: SimContext) -> TrainState:
        stops = self._stops(train)
        delay_sec = ctx.delays_sec.get(train.number, 0.0) + self._fog_delay(train, ctx)
        start_sec = stops[0][2] + delay_sec
        end_sec = stops[-1][1] + delay_sec
        te = ctx.sim_sec - delay_sec

        frozen = ctx.frozen.get(train.number)
        is_frozen = frozen is not None
        dist_km = frozen if is_frozen else self._distance_at_time(stops, te)

        total_km = train.cum_dist_km[-1]
        arrived = (not is_frozen) and ctx.sim_sec >= end_sec
        active = ctx.sim_sec >= start_sec and (is_frozen or not arrived)

        pos, heading = interpolate_along(train.polyline, train.poly_cum_km, dist_km)
        speed = 0.0 if (is_frozen or not active or arrived) else self._speed_kmh(stops, te)

        prev_station = None
        next_station = None
        for i, code in enumerate(train.route):
            if train.cum_dist_km[i] <= dist_km + 0.05:
                prev_station = code
            elif next_station is None:
                next_station = code

        current_section = None
        if not arrived:
            for i in range(len(train.route) - 1):
                if train.cum_dist_km[i] - 1e-3 <= dist_km < train.cum_dist_km[i + 1] - 1e-3:
                    current_section = f"{train.route[i]}-{train.route[i + 1]}"
                    break

        delay_min = round(delay_sec / 60)
        if arrived:
            status = "arrived"
        elif not active:
            status = "scheduled"
        elif is_frozen:
            status = "held"
        elif speed < 1 and delay_min > 0:
            status = "held"
        elif delay_min >= 5:
            status = "delayed"
        else:
            status = "running"

        eta_next = None
        if next_station is not None:
            d_next = train.cum_dist_km[train.route.index(next_station)]
            eta_next = int(self._time_at_distance(stops, d_next) + delay_sec)

        return TrainState(
            number=train.number,
            name=train.name,
            type=train.type,
            direction=train.direction,
            status=status,
            active=active and not arrived,
            dist_km=dist_km,
            position=pos,
            heading_deg=heading,
            speed_kmh=speed,
            delay_min=delay_min,
            next_station=next_station,
            prev_station=prev_station,
            current_section=current_section,
            eta_next_sec=eta_next,
            eta_final_sec=int(end_sec),
            est_passengers=est_passengers(train),
        )
