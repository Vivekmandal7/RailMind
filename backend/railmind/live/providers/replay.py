"""Schedule-driven fallback provider — the honest 'never blank the map' source.

When no real API key is configured (or the upstream is down), RailMind still
shows trains: it plays back the published timetable. Crucially these reports are
tagged ORIGIN_SIM, so every train they drive is labelled SIM in the UI — we
never dress schedule playback up as a live measurement.

Drop a real provider in (RapidAPI / indianrailapi) and the trains it covers flip
to LIVE/INTERPOLATED automatically; everything else keeps falling back here.
"""
from __future__ import annotations

import time
from typing import Callable, Optional

from ..interfaces import LiveReport, LiveStatusProvider, ORIGIN_SIM


class ReplayProvider(LiveStatusProvider):
    name = "replay"
    origin = ORIGIN_SIM
    rate_limited = False  # local synthesis — poll all trains every cycle

    def __init__(self, net, clock_fn: Callable[[], float]):
        # clock_fn returns the current sim clock (sec-from-midnight), so the
        # synthesized "report" matches where the schedule actually is right now.
        self.net = net
        self.clock_fn = clock_fn
        self._by_number = {t.number: t for t in net.trains}

    def available(self) -> bool:
        return True

    async def fetch(self, number: str) -> Optional[LiveReport]:
        t = self._by_number.get(number)
        if t is None:
            return None
        sim_sec = self.clock_fn()
        last, nxt, eta = self._segment(t, sim_sec)
        return LiveReport(
            number=number,
            delay_min=0,                  # on-schedule playback by definition
            last_station=last,
            next_station=nxt,
            eta_next_sec=eta,
            report_wall_ts=time.time(),
            origin=ORIGIN_SIM,
            provider=self.name,
        )

    @staticmethod
    def _segment(train, sim_sec: float) -> tuple[Optional[str], Optional[str], Optional[int]]:
        """Last departed stop + next stop + its planned arrival, per schedule."""
        last: Optional[str] = None
        nxt: Optional[str] = None
        eta: Optional[int] = None
        for s in train.schedule:
            if s.dep <= sim_sec:
                last = s.station
            elif nxt is None:
                nxt = s.station
                eta = s.arr
        if last is None:
            last = train.schedule[0].station
        return last, nxt, eta
