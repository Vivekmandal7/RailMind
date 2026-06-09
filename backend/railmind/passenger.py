"""Passenger impact estimator — baseline heuristic, wired for real reporting."""
from __future__ import annotations

from .interfaces import (
    DigitalTwinProto,
    PassengerImpact,
    PassengerImpactEstimator,
    SimContext,
    TrainState,
)
from .twin import est_passengers


class HeuristicPassengerImpact(PassengerImpactEstimator):
    def estimate(
        self, twin: DigitalTwinProto, states: list[TrainState], ctx: SimContext
    ) -> list[PassengerImpact]:
        out: list[PassengerImpact] = []
        trains = {t.number: t for t in twin.trains}
        for s in states:
            if not s.active:
                continue
            train = trains.get(s.number)
            if train is None:
                continue
            cap = train.capacity_pax
            onboard = s.est_passengers
            occ = onboard / cap if cap else 0.0
            affected = onboard if s.delay_min >= 5 else int(onboard * 0.15)
            miss = int(affected * min(0.4, s.delay_min / 30)) if s.delay_min >= 10 else 0
            conn = 2 if train.type == "express" and s.delay_min >= 8 else (1 if s.delay_min >= 5 else 0)
            out.append(PassengerImpact(
                train=s.number,
                passengers_onboard=onboard,
                passengers_affected=affected,
                connections_at_risk=conn,
                likely_to_miss=miss,
                occupancy=round(occ, 2),
            ))
        return out
