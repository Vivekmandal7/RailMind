"""Predictor implementations.

``DelayCascadePredictor`` projects how a train's current delay propagates to
downstream services that share its upcoming sections within a time window.
A future ``MLPredictor`` (trained on historical running data) implements the
same ``predict`` signature.
"""
from __future__ import annotations

from .interfaces import DigitalTwinProto, Prediction, Predictor, SimContext, TrainState


def _canonical(section_id: str) -> str:
    a, b = section_id.split("-")
    return f"{a}-{b}" if a < b else f"{b}-{a}"


class DelayCascadePredictor(Predictor):
    def __init__(self, window_min: int = 35, transfer: float = 0.55):
        self.window_sec = window_min * 60
        self.transfer = transfer  # fraction of delay that cascades downstream

    def predict(
        self, twin: DigitalTwinProto, states: list[TrainState], ctx: SimContext
    ) -> list[Prediction]:
        by_num = {s.number: s for s in states}
        preds: list[Prediction] = []

        for s in states:
            if not s.active or s.delay_min < 5:
                continue
            train = next((t for t in twin.trains if t.number == s.number), None)
            if train is None or s.next_station is None:
                continue
            start = train.route.index(s.next_station)
            future = {
                _canonical(f"{train.route[i]}-{train.route[i + 1]}")
                for i in range(max(0, start - 1), len(train.route) - 1)
            }
            for other in states:
                if other.number == s.number or not other.active:
                    continue
                ot = next((t for t in twin.trains if t.number == other.number), None)
                if ot is None:
                    continue
                shares = any(
                    _canonical(f"{ot.route[i]}-{ot.route[i + 1]}") in future
                    for i in range(len(ot.route) - 1)
                )
                close = abs((other.eta_next_sec or 0) - (s.eta_next_sec or 0)) < self.window_sec
                if shares and close:
                    projected = round(s.delay_min * self.transfer)
                    if projected >= 1:
                        preds.append(
                            Prediction(
                                train=other.number,
                                predicted_delay_min=max(other.delay_min, projected),
                                cause=f"cascade from {s.number}",
                            )
                        )
        # dedupe keeping worst projection per train
        worst: dict[str, Prediction] = {}
        for p in preds:
            if p.train not in worst or p.predicted_delay_min > worst[p.train].predicted_delay_min:
                worst[p.train] = p
        return list(worst.values())
