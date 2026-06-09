"""Incident timeline — audit log of pipeline events for the control room."""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field


@dataclass
class TimelineEvent:
    id: str
    kind: str  # inject|forecast|conflict|optimize|verify|apply|blocked|outcome|clear
    title: str
    detail: str
    severity: str  # info | warning | critical | safe
    sim_sec: float
    ref_id: str | None = None
    wall_ms: int = 0


class TimelineLog:
    """Rolling in-memory decision log (newest first)."""

    def __init__(self, max_len: int = 80):
        self.max_len = max_len
        self._events: list[TimelineEvent] = []
        self._seen: set[str] = set()

    def push(
        self,
        kind: str,
        title: str,
        detail: str,
        *,
        severity: str = "info",
        sim_sec: float,
        ref_id: str | None = None,
        dedupe_key: str | None = None,
    ) -> TimelineEvent | None:
        if dedupe_key and dedupe_key in self._seen:
            return None
        if dedupe_key:
            self._seen.add(dedupe_key)
        ev = TimelineEvent(
            id=str(uuid.uuid4())[:8],
            kind=kind,
            title=title,
            detail=detail,
            severity=severity,
            sim_sec=sim_sec,
            ref_id=ref_id,
            wall_ms=int(time.time() * 1000),
        )
        self._events.insert(0, ev)
        self._events = self._events[: self.max_len]
        return ev

    def snapshot(self) -> list[TimelineEvent]:
        return list(self._events)

    def clear(self) -> None:
        self._events.clear()
        self._seen.clear()
