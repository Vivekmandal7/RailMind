"""Hybrid predictor — merges cascade ripple + ML delay forecasts."""
from __future__ import annotations

from .forecaster import GBMDelayForecaster
from .interfaces import (
    DelayForecaster,
    DigitalTwinProto,
    Prediction,
    Predictor,
    SimContext,
    TrainState,
)
from .predictor import DelayCascadePredictor


class HybridPredictor(Predictor):
    """Cascade heuristic + GBM delay forecaster for look-ahead conflict prediction."""

    def __init__(self, cascade: DelayCascadePredictor | None = None,
                 forecaster: DelayForecaster | None = None):
        self.cascade = cascade or DelayCascadePredictor()
        self.forecaster = forecaster or GBMDelayForecaster()

    def predict(
        self, twin: DigitalTwinProto, states: list[TrainState], ctx: SimContext
    ) -> list[Prediction]:
        cascade_preds = self.cascade.predict(twin, states, ctx)
        forecasts = self.forecaster.forecast(twin, states, ctx)

        worst: dict[str, Prediction] = {p.train: p for p in cascade_preds}

        for fc in forecasts:
            tag = "ml" if fc.model == "ml" else "heuristic"
            cause = f"{tag} forecast: +{fc.predicted_delay_min}m over next {len(fc.horizon_stations)} stops"
            existing = worst.get(fc.train)
            proj = fc.predicted_delay_min
            if existing:
                proj = max(existing.predicted_delay_min, proj)
                cause = f"{existing.cause}; {cause}"
            worst[fc.train] = Prediction(
                train=fc.train, predicted_delay_min=proj, cause=cause,
            )

        return list(worst.values())

    @property
    def forecaster_kind(self) -> str:
        if hasattr(self.forecaster, "kind"):
            return getattr(self.forecaster, "kind", "heuristic")
        return "heuristic"
