"""Folds ``LiveReport``s into the twin and tags every train with provenance.

This is the honest core of the digital twin. A live ``delay_min`` shifts the
train's planned schedule, so the twin interpolates its position along the REAL
track polyline between the last reported station and the next — exactly what a
control centre does. The provenance tag then records whether that position is
anchored to a measured ping (LIVE / INTERPOLATED / PREDICTED) or is purely
schedule-driven (SIM):

    LIVE          a real report arrived within the freshness window
    INTERPOLATED  a real report exists but we are now between pings
    PREDICTED     the last real ping is stale; we are projecting forward
    SIM           no real feed for this train — pure schedule playback
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Optional

from .interfaces import ORIGIN_LIVE
from .store import LiveStore

SOURCE_LIVE = "live"
SOURCE_INTERPOLATED = "interpolated"
SOURCE_PREDICTED = "predicted"
SOURCE_SIM = "sim"


@dataclass
class Provenance:
    source: str
    confidence: float
    last_report_age_sec: Optional[int]


class Reconciler:
    def __init__(
        self,
        store: LiveStore,
        fresh_window_sec: float = 180.0,
        stale_window_sec: float = 900.0,
    ):
        self.store = store
        # < fresh           -> LIVE
        # fresh .. stale     -> INTERPOLATED
        # >= stale           -> PREDICTED
        self.fresh = fresh_window_sec
        self.stale = stale_window_sec

    def live_delays(self, now: Optional[float] = None) -> dict[str, float]:
        """delay_sec per train from the latest report (folded into the twin).

        SIM/replay reports carry delay 0 (on-schedule), so they don't perturb
        motion — they only supply last/next station + ETA + provenance. A real
        feed's ``delay_min`` is what actually shifts the train on the rails.
        """
        out: dict[str, float] = {}
        for r in self.store.all(now):
            if r.delay_min:
                out[r.number] = r.delay_min * 60.0
        return out

    def provenance(self, number: str, now: Optional[float] = None) -> Provenance:
        now = time.time() if now is None else now
        r = self.store.get(number, now)
        if r is None:
            return Provenance(SOURCE_SIM, 0.35, None)
        age = max(0.0, now - r.report_wall_ts)
        if r.origin != ORIGIN_LIVE:
            return Provenance(SOURCE_SIM, 0.45, int(age))
        if age < self.fresh:
            return Provenance(SOURCE_LIVE, 0.95, int(age))
        if age < self.stale:
            # fade confidence linearly across the interpolation window
            span = max(1.0, self.stale - self.fresh)
            conf = 0.80 - 0.30 * (age - self.fresh) / span
            return Provenance(SOURCE_INTERPOLATED, round(conf, 2), int(age))
        return Provenance(SOURCE_PREDICTED, 0.30, int(age))
