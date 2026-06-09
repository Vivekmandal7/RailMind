"""TTL cache of the latest ``LiveReport`` per train + freshness accounting.

In-memory by design (single-process demo). The same surface (put/get/all) maps
cleanly onto Redis if the platform ever needs multi-worker ingestion.
"""
from __future__ import annotations

import time
from typing import Optional

from .interfaces import LiveReport, ORIGIN_LIVE


class LiveStore:
    def __init__(self, ttl_sec: float = 1800.0):
        # Reports older than ttl are treated as gone (the train falls back to SIM).
        self.ttl = ttl_sec
        self._reports: dict[str, LiveReport] = {}

    def put(self, report: LiveReport) -> None:
        self._reports[report.number] = report

    def get(self, number: str, now: Optional[float] = None) -> Optional[LiveReport]:
        r = self._reports.get(number)
        if r is None:
            return None
        now = time.time() if now is None else now
        if now - r.report_wall_ts > self.ttl:
            return None
        return r

    def all(self, now: Optional[float] = None) -> list[LiveReport]:
        now = time.time() if now is None else now
        return [r for r in self._reports.values() if now - r.report_wall_ts <= self.ttl]

    def live_reports(self, now: Optional[float] = None) -> list[LiveReport]:
        """Only reports that came from a real operational feed."""
        return [r for r in self.all(now) if r.origin == ORIGIN_LIVE]

    def newest_live_age_sec(self, now: Optional[float] = None) -> Optional[float]:
        """Wall-clock age (sec) of the freshest LIVE report — the 'updated Xm ago'.

        Returns None when no real feed is flowing (pure SIM), so the UI can say so.
        """
        live = self.live_reports(now)
        if not live:
            return None
        now = time.time() if now is None else now
        return min(now - r.report_wall_ts for r in live)
