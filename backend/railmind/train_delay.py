"""Train and save the delay forecaster ML model.

Uses gradient boosting on physically-grounded synthetic features matching
``forecaster.FEATURE_NAMES``. If a Kaggle CSV is present at
``data/ir_delays.csv`` it is blended in; otherwise synthetic data is generated
from Indian Railways delay patterns.

Usage:
    python -m railmind.train_delay
"""
from __future__ import annotations

import os
from pathlib import Path

import numpy as np

from .forecaster import FEATURE_NAMES, MODELS_DIR, MODEL_PATH, featurize

N_SAMPLES = 8000
RANDOM_SEED = 42


def _synthetic(n: int) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(RANDOM_SEED)
    X, y = [], []
    for _ in range(n):
        hour = float(rng.uniform(0, 24))
        is_express = rng.random() < 0.45
        cur_delay = float(rng.exponential(4) if rng.random() < 0.35 else 0)
        remaining_km = float(rng.uniform(20, 800))
        remaining_stops = int(rng.integers(2, 18))
        ghat = int(rng.integers(0, 4))
        speed_factor = float(rng.choice([1.0, 1.0, 1.0, 0.6]))
        coaches = int(rng.integers(8, 24))
        f = featurize(
            hour=hour, is_express=is_express, current_delay_min=cur_delay,
            remaining_km=remaining_km, remaining_stops=remaining_stops,
            ghat_ahead=ghat, speed_factor=speed_factor, coaches=coaches,
        )
        extra = 0.35 * cur_delay + 2.4 * ghat
        if speed_factor < 1:
            extra += (1.0 / speed_factor - 1.0) * 0.05 * remaining_km
        if 8 <= hour <= 11 or 17 <= hour <= 20:
            extra += 0.02 * remaining_km
        if is_express:
            extra *= 0.9
        extra += rng.normal(0, 0.8)
        X.append(f)
        y.append(max(0.0, extra))
    return np.array(X), np.array(y)


def _load_kaggle_csv(path: Path) -> tuple[np.ndarray, np.ndarray] | None:
    if not path.exists():
        return None
    try:
        import csv
        rows = list(csv.DictReader(path.open()))
        if len(rows) < 100:
            return None
        rng = np.random.default_rng(RANDOM_SEED)
        X, y = [], []
        for row in rows[:5000]:
            delay = float(row.get("delay_min") or row.get("Delay") or row.get("delay") or 0)
            hour = float(row.get("hour") or rng.uniform(6, 22))
            f = featurize(
                hour=hour, is_express=rng.random() < 0.5,
                current_delay_min=max(0, delay), remaining_km=float(rng.uniform(50, 600)),
                remaining_stops=int(rng.integers(3, 12)), ghat_ahead=int(rng.integers(0, 2)),
                speed_factor=1.0, coaches=18,
            )
            X.append(f)
            y.append(max(0.0, delay * 0.4 + rng.normal(0, 1)))
        return np.array(X), np.array(y)
    except Exception:
        return None


def train_and_save() -> Path:
    from sklearn.ensemble import GradientBoostingRegressor
    import joblib

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    data_dir = Path(__file__).resolve().parent.parent / "data"
    kaggle = _load_kaggle_csv(data_dir / "ir_delays.csv")
    X_syn, y_syn = _synthetic(N_SAMPLES)
    if kaggle:
        X_k, y_k = kaggle
        X = np.vstack([X_syn, X_k])
        y = np.concatenate([y_syn, y_k])
        source = f"synthetic({len(y_syn)}) + kaggle({len(y_k)})"
    else:
        X, y = X_syn, y_syn
        source = f"synthetic({len(y_syn)})"

    model = GradientBoostingRegressor(
        n_estimators=120, max_depth=4, learning_rate=0.08,
        subsample=0.85, random_state=RANDOM_SEED,
    )
    model.fit(X, y)
    joblib.dump({"model": model, "features": FEATURE_NAMES, "source": source}, MODEL_PATH)
    score = model.score(X, y)
    print(f"Saved {MODEL_PATH} — R²={score:.3f} — {source}")
    return MODEL_PATH


if __name__ == "__main__":
    train_and_save()
