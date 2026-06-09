"""Live-status provider interface + the report it yields.

A ``LiveStatusProvider`` abstracts ONE source of running-status data: an
NTES-backed API (indianrailapi / RapidAPI), a replay of recorded pings, or a
schedule-driven fallback. The ingestion worker polls it; the reconciler folds
its reports into the twin. Swap the upstream feed by swapping one class — no
other module changes.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional

# Provenance ORIGIN a report can carry. This is the honest provenance seam:
#   live -> measured by a real operational feed (NTES-backed)
#   sim  -> synthesized from the public schedule (the honest, never-blank fallback)
ORIGIN_LIVE = "live"
ORIGIN_SIM = "sim"


@dataclass
class LiveReport:
    """One running-status observation for a single train.

    Mirrors exactly what NTES exposes: last reported station, delay (min), next
    station, ETA. ``report_wall_ts`` is the REAL wall-clock epoch second the data
    was observed — it drives the freshness label ("updated 2m ago"), never the
    accelerated simulation clock.
    """

    number: str
    delay_min: int
    last_station: Optional[str]
    next_station: Optional[str]
    eta_next_sec: Optional[int]          # sec-from-midnight, schedule frame
    report_wall_ts: float                # epoch seconds (time.time())
    origin: str = ORIGIN_SIM             # ORIGIN_LIVE | ORIGIN_SIM
    provider: str = "replay"
    raw: Optional[dict] = None


class LiveStatusProvider(ABC):
    """Abstract running-status source. One concrete class per upstream API."""

    name: str = "provider"
    origin: str = ORIGIN_SIM
    # True if the upstream enforces rate limits (poll in small staggered batches).
    rate_limited: bool = True

    @abstractmethod
    def available(self) -> bool:
        """True if this provider can actually serve (e.g. API key present)."""

    @abstractmethod
    async def fetch(self, number: str) -> Optional[LiveReport]:
        """Latest report for one train, or None if the feed has nothing for it."""

    async def aclose(self) -> None:
        """Release any held resources (HTTP clients). Default: no-op."""
        return None
