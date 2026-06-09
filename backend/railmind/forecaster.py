"""Delay Forecaster — module #1.

A gradient-boosted regression model predicts each train's *additional* delay
accrued over its next stations, from features grounded in the live twin:
hour-of-day, train class, current delay (persistence), remaining distance/stops,
ghat (steep-grade) sections ahead, and any network-wide speed restriction (fog).

REAL ML: ``train_forecaster.py`` fits a ``GradientBoostingRegressor`` on Kaggle
Indian-Railways running/delay data (or a physically-grounded synthetic set when
the CSV is absent) and saves ``models/delay_forecaster.joblib``. This class
loads it at startup. If neither sklearn nor the artifact is present it falls
back to a transparent heuristic so the engine always runs.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from .interfaces import (
    DelayForecast,
    DelayForecaster,
    DigitalTwinProto,
    SimContext,
    StationForecast,
    Train,
    TrainState,
)

MODELS_DIR = Path(os.environ.get(
    "RAILMIND_MODELS_DIR", str(Path(__file__).resolve().parent.parent / "models")
))
MODEL_PATH = MODELS_DIR / "delay_forecaster.joblib"

# Stable feature order shared by training and inference.
FEATURE_NAMES = [
    "hour", "is_express", "is_local", "current_delay_min",
    "remaining_km", "remaining_stops", "ghat_ahead", "speed_factor", "coaches",
]


def featurize(
    *, hour: float, is_express: bool, current_delay_min: float, remaining_km: float,
    remaining_stops: int, ghat_ahead: int, speed_factor: float, coaches: int,
) -> list[float]:
    return [
        float(hour), 1.0 if is_express else 0.0, 0.0 if is_express else 1.0,
        float(current_delay_min), float(remaining_km), float(remaining_stops),
        float(ghat_ahead), float(speed_factor), float(coaches),
    ]


def _remaining(train: Train, state: TrainState) -> tuple[float, int, list[str]]:
    """Remaining km, remaining stop count and the list of upcoming stations."""
    nxt = state.next_station
    if nxt is None or nxt not in train.route:
        return 0.0, 0, []
    i = train.route.index(nxt)
    remaining_km = max(0.0, train.cum_dist_km[-1] - state.dist_km)
    upcoming = train.route[i:]
    return remaining_km, len(upcoming), upcoming


def _ghat_ahead(twin: DigitalTwinProto, upcoming: list[str]) -> int:
    n = 0
    for a, b in zip(upcoming, upcoming[1:]):
        sec = twin.section(f"{a}-{b}") or twin.section(f"{b}-{a}")
        if sec and sec.ghat:
            n += 1
    return n


class GBMDelayForecaster(DelayForecaster):
    """Loads the trained model; degrades to a heuristic when unavailable."""

    def __init__(self, model_path: Path | str = MODEL_PATH):
        self.model_path = Path(model_path)
        self.model = None
        self.kind = "heuristic"
        self.model_source = ""
        self._load()

    def _load(self) -> None:
        try:
            import joblib  # type: ignore
        except Exception:
            return
        if not self.model_path.exists():
            return
        try:
            loaded = joblib.load(self.model_path)
            if isinstance(loaded, dict):
                self.model = loaded.get("model")
                src = loaded.get("source", "ml")
            else:
                self.model = loaded
                src = "ml"
            if self.model is not None:
                self.kind = "ml"
                self.model_source = src
        except Exception:
            self.model = None
            self.kind = "heuristic"
            self.model_source = ""

    # ---- inference ------------------------------------------------------- #
    def forecast(
        self, twin: DigitalTwinProto, states: list[TrainState], ctx: SimContext
    ) -> list[DelayForecast]:
        hour = (ctx.sim_sec / 3600.0) % 24
        trains = {t.number: t for t in twin.trains}
        feats: list[list[float]] = []
        meta: list[tuple[TrainState, Train, list[str], float]] = []

        for s in states:
            if not s.active:
                continue
            train = trains.get(s.number)
            if train is None:
                continue
            remaining_km, remaining_stops, upcoming = _remaining(train, s)
            ghat = _ghat_ahead(twin, upcoming)
            feats.append(featurize(
                hour=hour, is_express=train.type == "express",
                current_delay_min=s.delay_min, remaining_km=remaining_km,
                remaining_stops=remaining_stops, ghat_ahead=ghat,
                speed_factor=ctx.speed_factor, coaches=train.coaches,
            ))
            meta.append((s, train, upcoming, remaining_km))

        if not meta:
            return []

        if self.model is not None:
            try:
                import numpy as np  # type: ignore
                preds = self.model.predict(np.array(feats))
                extra = [max(0.0, float(p)) for p in preds]
                conf = 0.82
                model_tag = "ml"
            except Exception:
                extra = [self._heuristic_extra(f) for f in feats]
                conf, model_tag = 0.6, "heuristic"
        else:
            extra = [self._heuristic_extra(f) for f in feats]
            conf, model_tag = 0.6, "heuristic"

        out: list[DelayForecast] = []
        for (s, train, upcoming, _), add in zip(meta, extra):
            total = round(s.delay_min + add)
            if total < 1:
                continue
            horizon = self._spread(s.delay_min, add, upcoming)
            out.append(DelayForecast(
                train=s.number, predicted_delay_min=total,
                horizon_stations=horizon, model=model_tag, confidence=conf,
            ))
        return out

    @staticmethod
    def _spread(base_delay: float, extra: float, upcoming: list[str]) -> list[StationForecast]:
        stops = upcoming[: min(len(upcoming), 6)]
        if not stops:
            return []
        out = []
        for i, code in enumerate(stops):
            frac = (i + 1) / len(stops)
            out.append(StationForecast(station=code, eta_delay_min=round(base_delay + extra * frac)))
        return out

    @staticmethod
    def _heuristic_extra(f: list[float]) -> float:
        d = dict(zip(FEATURE_NAMES, f))
        # persistence + ghat grade penalty + fog stretch + peak-hour congestion
        extra = 0.35 * d["current_delay_min"]
        extra += 2.4 * d["ghat_ahead"]
        if d["speed_factor"] < 1:
            extra += (1.0 / max(0.3, d["speed_factor"]) - 1.0) * 0.05 * d["remaining_km"]
        if 8 <= d["hour"] <= 11 or 17 <= d["hour"] <= 20:
            extra += 0.02 * d["remaining_km"]
        if d["is_express"]:
            extra *= 0.9  # expresses recover faster
        return max(0.0, extra)
