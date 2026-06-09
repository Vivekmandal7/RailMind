"""Anomaly sentinel — lightweight statistical baseline."""
from __future__ import annotations

import uuid

from .interfaces import Anomaly, AnomalySentinel, DigitalTwinProto, SimContext, TrainState


class BaselineAnomalySentinel(AnomalySentinel):
    def scan(
        self, twin: DigitalTwinProto, states: list[TrainState], ctx: SimContext
    ) -> list[Anomaly]:
        out: list[Anomaly] = []
        delayed = [s for s in states if s.active and s.delay_min >= 15]
        if len(delayed) >= 3:
            out.append(Anomaly(
                id=str(uuid.uuid4()), scope="network", ref="corridor",
                score=min(1.0, len(delayed) / 10),
                severity="warning" if len(delayed) < 6 else "critical",
                message=f"{len(delayed)} trains running 15+ min late — systemic delay pattern",
            ))
        for s in states:
            if s.active and s.speed_kmh < 5 and s.number not in ctx.frozen and s.delay_min > 0:
                out.append(Anomaly(
                    id=str(uuid.uuid4()), scope="train", ref=s.number,
                    score=0.7, severity="warning",
                    message=f"{s.number} crawling at {s.speed_kmh:.0f} km/h with +{s.delay_min}m delay",
                ))
        if ctx.speed_factor < 1.0:
            out.append(Anomaly(
                id=str(uuid.uuid4()), scope="network", ref="speed",
                score=0.5, severity="info",
                message=f"Network speed restriction active ({ctx.speed_factor:.0%} of normal)",
            ))
        return out[:8]
