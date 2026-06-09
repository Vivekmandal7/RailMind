"""RapidAPI NTES-backed live train status provider.

Wired to the "Indian Railway IRCTC" listing (indian-railway-irctc.p.rapidapi.com,
endpoint /api/trains/v1/train/status), whose response carries the full station
list with both scheduled and actual/projected times. We derive the train's
delay from actual-vs-scheduled at its current station — a real measurement — and
the next station + projected ETA from the following stop.

Config (backend/.env):
    RAILMIND_RAPIDAPI_KEY=<your rapidapi key>
    RAILMIND_RAPIDAPI_HOST=indian-railway-irctc.p.rapidapi.com
    RAILMIND_RAPIDAPI_PATH=/api/trains/v1/train/status
    RAILMIND_RAPIDAPI_DATE=YYYYMMDD            # optional: pin the journey date

If the key is absent, ``available()`` is False and the engine cleanly falls back
to the replay provider (every train tagged SIM) — never a blank map. ``parse``
is the only thing to adjust if you subscribe to a differently-shaped listing.
"""
from __future__ import annotations

import datetime
import os
import time
from typing import Optional

import httpx

from ..interfaces import LiveReport, LiveStatusProvider, ORIGIN_LIVE


class RapidApiProvider(LiveStatusProvider):
    name = "rapidapi"
    origin = ORIGIN_LIVE
    rate_limited = True

    def __init__(self, net, *, timeout: float = 12.0):
        self.net = net
        self.key = os.environ.get("RAILMIND_RAPIDAPI_KEY", "").strip()
        self.host = os.environ.get("RAILMIND_RAPIDAPI_HOST", "indian-railway-irctc.p.rapidapi.com").strip()
        self.path = os.environ.get("RAILMIND_RAPIDAPI_PATH", "/api/trains/v1/train/status").strip()
        self.date_override = os.environ.get("RAILMIND_RAPIDAPI_DATE", "").strip()
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None
        # map known station NAMES -> our codes so reports anchor to our geometry
        self._name_to_code = {s.name.lower(): s.code for s in net.stations.values()}
        self._codes = {s.code for s in net.stations.values()}

    def available(self) -> bool:
        return bool(self.key)

    def _journey_date(self) -> str:
        if self.date_override:
            return self.date_override
        ist = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=5, minutes=30)
        return ist.strftime("%Y%m%d")

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=f"https://{self.host}",
                timeout=self.timeout,
                headers={
                    "x-rapidapi-key": self.key,
                    "x-rapidapi-host": self.host,
                    "x-rapid-api": "rapid-api-database",
                    "Content-Type": "application/json",
                },
            )
        return self._client

    async def fetch(self, number: str) -> Optional[LiveReport]:
        if not self.available():
            return None
        try:
            resp = await self._http().get(
                self.path,
                params={
                    "train_number": number,
                    "departure_date": self._journey_date(),
                    "isH5": "true",
                    "client": "web",
                    "deviceIdentifier": "web",
                },
            )
            resp.raise_for_status()
            payload = resp.json()
        except Exception:
            return None
        return self.parse(payload, number)

    def parse(self, payload: dict, number: str) -> Optional[LiveReport]:
        """Map a live-status payload to a LiveReport. Tolerant by design."""
        if not isinstance(payload, dict):
            return None
        body = payload.get("body") if isinstance(payload.get("body"), dict) else None
        if body is None:
            return None
        stations = body.get("stations")
        if not isinstance(stations, list) or not stations:
            return None

        terminated = bool(body.get("terminated"))
        cur_code = body.get("current_station")
        idx = next(
            (i for i, s in enumerate(stations) if s.get("stationCode") == cur_code),
            None,
        )
        if idx is None:
            # fallback: the last stop that already has an actual arrival
            idx = max(
                (i for i, s in enumerate(stations) if s.get("actual_arrival_time")),
                default=len(stations) - 1,
            )
        cur = stations[idx]

        delay_min = _delay_min(cur.get("arrivalTime"), cur.get("actual_arrival_time"))
        last = self._code(cur.get("stationCode"))

        nxt = None
        eta = None
        if not terminated and idx < len(stations) - 1:
            nx = stations[idx + 1]
            nxt = self._code(nx.get("stationCode"))
            # actual_arrival_time on a future stop is the projected ETA
            eta = _hhmm_to_sec(nx.get("actual_arrival_time") or nx.get("arrivalTime"))

        return LiveReport(
            number=number,
            delay_min=delay_min,
            last_station=last,
            next_station=nxt,
            eta_next_sec=eta,
            report_wall_ts=time.time(),
            origin=ORIGIN_LIVE,
            provider=self.name,
            raw={
                "current_station": cur_code,
                "terminated": terminated,
                "message": body.get("train_status_message"),
            },
        )

    def _code(self, name_or_code: Optional[str]) -> Optional[str]:
        if not name_or_code:
            return None
        token = name_or_code.strip()
        if token.upper() in self._codes:
            return token.upper()
        return self._name_to_code.get(token.lower(), token.upper())

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None


def _hhmm_to_min(t: Optional[str]) -> Optional[int]:
    if not t or not isinstance(t, str):
        return None
    parts = t.strip().split(":")
    if len(parts) < 2:
        return None
    try:
        return (int(parts[0]) % 24) * 60 + (int(parts[1]) % 60)
    except ValueError:
        return None


def _hhmm_to_sec(t: Optional[str]) -> Optional[int]:
    m = _hhmm_to_min(t)
    return None if m is None else m * 60


def _delay_min(scheduled_hhmm: Optional[str], actual_hhmm: Optional[str]) -> int:
    """Minutes late = actual − scheduled, normalised across the midnight wrap."""
    s = _hhmm_to_min(scheduled_hhmm)
    a = _hhmm_to_min(actual_hhmm)
    if s is None or a is None:
        return 0
    diff = a - s
    if diff > 720:
        diff -= 1440
    elif diff < -720:
        diff += 1440
    return diff
