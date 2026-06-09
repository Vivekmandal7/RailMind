"""AI Engine status tracker — surfaces each brain module in the control room."""
from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Iterator

from .interfaces import ModuleStatus

MODULE_DEFS: list[tuple[str, str]] = [
    ("delay_ml", "Delay ML"),
    ("cascade", "Cascade Predictor"),
    ("conflict_detector", "Conflict Detector"),
    ("optimizer", "OR-Tools Optimizer"),
    ("verifier", "Multi-LLM Verifier"),
    ("nl_agent", "NL Agent"),
    ("passenger", "Passenger Impact"),
    ("anomaly", "Anomaly Sentinel"),
]


class BrainTracker:
    """Records live status, latency and last action for every brain module."""

    def __init__(self) -> None:
        self._modules: dict[str, ModuleStatus] = {
            key: ModuleStatus(
                key=key, name=name, status="idle",
                last_action="Standing by", latency_ms=0, detail="",
            )
            for key, name in MODULE_DEFS
        }

    def snapshot(self) -> list[ModuleStatus]:
        return list(self._modules.values())

    def set(
        self, key: str, *, status: str, last_action: str,
        latency_ms: int = 0, detail: str = "",
    ) -> None:
        cur = self._modules.get(key)
        name = cur.name if cur else key
        self._modules[key] = ModuleStatus(
            key=key, name=name, status=status,
            last_action=last_action, latency_ms=latency_ms, detail=detail,
        )

    @contextmanager
    def track(self, key: str, running_action: str = "Running") -> Iterator[None]:
        cur = self._modules.get(key)
        name = cur.name if cur else key
        t0 = time.perf_counter()
        self._modules[key] = ModuleStatus(
            key=key, name=name, status="running",
            last_action=running_action, latency_ms=0, detail="",
        )
        try:
            yield
            ms = int((time.perf_counter() - t0) * 1000)
            prev = self._modules[key]
            self._modules[key] = ModuleStatus(
                key=key, name=name, status="ok",
                last_action=prev.last_action, latency_ms=ms, detail=prev.detail,
            )
        except Exception as exc:
            ms = int((time.perf_counter() - t0) * 1000)
            self._modules[key] = ModuleStatus(
                key=key, name=name, status="error",
                last_action=f"Error: {exc}", latency_ms=ms, detail=str(exc)[:120],
            )
            raise

    def finish(self, key: str, *, status: str, last_action: str,
               latency_ms: int, detail: str = "") -> None:
        self.set(key, status=status, last_action=last_action,
                 latency_ms=latency_ms, detail=detail)
