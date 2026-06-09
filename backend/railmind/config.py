"""Config-driven assembly + dependency injection."""
from __future__ import annotations

from pathlib import Path
from typing import Callable

import yaml

from .anomaly import BaselineAnomalySentinel
from .brain import BrainTracker
from .datasource import GeoJSONDataSource
from .detectors import RuleBasedConflictDetector
from .explainer import LLMExplainer
from .forecaster import GBMDelayForecaster
from .geo import parse_hhmm
from .interfaces import ConflictDetector, DataSource, Optimizer, Predictor, Verifier
from .live import IngestionWorker, LiveStore, Reconciler
from .live.providers import build_provider
from .network import NetworkGraph
from .optimizer import GreedyOptimizer
from .optimizer_ortools import CpSatOptimizer
from .orchestrator import Orchestrator
from .passenger import HeuristicPassengerImpact
from .predictor import DelayCascadePredictor
from .predictor_hybrid import HybridPredictor
from .twin import DigitalTwin
from .verifier import RuleBasedVerifier
from .verifier_llm import MultiModelVerifier

DATA_SOURCES: dict[str, Callable[..., DataSource]] = {
    "geojson": GeoJSONDataSource,
}
DETECTORS: dict[str, Callable[..., ConflictDetector]] = {
    "rule_based": RuleBasedConflictDetector,
}
PREDICTORS: dict[str, Callable[..., Predictor]] = {
    "cascade": DelayCascadePredictor,
    "hybrid": HybridPredictor,
}
OPTIMIZERS: dict[str, Callable[..., Optimizer]] = {
    "greedy": GreedyOptimizer,
    "cp_sat": CpSatOptimizer,
}
VERIFIERS: dict[str, Callable[..., Verifier]] = {
    "rule_based": RuleBasedVerifier,
    "llm_consensus": MultiModelVerifier,
}


def build_orchestrator(config_path: str | Path) -> Orchestrator:
    config_path = Path(config_path)
    base = config_path.parent
    cfg = yaml.safe_load(config_path.read_text())

    ds_cfg = cfg["data_source"]
    source = DATA_SOURCES[ds_cfg["kind"]](
        stations_path=ds_cfg["stations"],
        sections_path=ds_cfg["sections"],
        timetable_path=ds_cfg["timetable"],
        base=base,
    )
    net = NetworkGraph(source)

    kin = cfg.get("kinematics", {})
    twin = DigitalTwin(net, station_dwell_min_sec=kin.get("station_dwell_min_sec", 30))

    mods = cfg.get("modules", {})
    detector = DETECTORS[mods.get("conflict_detector", "rule_based")]()
    predictor_key = mods.get("predictor", "hybrid")
    if predictor_key == "hybrid":
        forecaster = GBMDelayForecaster()
        predictor = HybridPredictor(forecaster=forecaster)
    else:
        forecaster = GBMDelayForecaster()
        predictor = PREDICTORS.get(predictor_key, DelayCascadePredictor)()

    optimizer = OPTIMIZERS[mods.get("optimizer", "cp_sat")]()
    verifier = VERIFIERS[mods.get("verifier", "llm_consensus")]()

    sim = cfg.get("simulation", {})
    start_clock = sim.get("start_clock")
    start_sec = parse_hhmm(start_clock) if start_clock else None

    orch = Orchestrator(
        net, twin, detector, predictor, optimizer, verifier,
        forecaster=forecaster,
        explainer=LLMExplainer(),
        passenger=HeuristicPassengerImpact(),
        anomaly=BaselineAnomalySentinel(),
        brain=BrainTracker(),
        time_scale=float(sim.get("time_scale", 60.0)),
        start_clock_sec=start_sec,
        loop=bool(sim.get("loop", True)),
        autonomous=bool(mods.get("autonomous", False)),
    )
    corridor = cfg.get("corridor", {})
    orch.corridor_id = corridor.get("id", "corridor")
    orch.corridor_name = corridor.get("name", "Corridor")
    orch.tick_hz = float(sim.get("tick_hz", 5))

    _attach_live_layer(orch, cfg.get("live", {}))
    return orch


def _attach_live_layer(orch: Orchestrator, live_cfg: dict) -> None:
    """Build the swappable live-data spine and attach it to the orchestrator.

    ``kind: rapidapi`` uses a real NTES-backed feed when a key is present and
    otherwise falls back to the always-on replay source, so the map is never
    blank and every train is honestly labelled.
    """
    kind = live_cfg.get("kind", "replay")
    store = LiveStore(ttl_sec=float(live_cfg.get("ttl_sec", 1800)))
    provider = build_provider(kind, orch.net, lambda: orch.sim_sec)

    # Honest degrade: a real provider with no key falls back to replay.
    if not provider.available():
        provider = build_provider("replay", orch.net, lambda: orch.sim_sec)

    reconciler = Reconciler(
        store,
        fresh_window_sec=float(live_cfg.get("fresh_window_sec", 180)),
        stale_window_sec=float(live_cfg.get("stale_window_sec", 900)),
    )
    worker = IngestionWorker(
        provider, store, [t.number for t in orch.net.trains],
        interval_sec=float(live_cfg.get("poll_interval_sec", 20)),
        batch=int(live_cfg.get("poll_batch", 8)),
        stagger_sec=float(live_cfg.get("poll_stagger_sec", 0.4)),
        max_trains=int(live_cfg.get("poll_max_trains", 0)),
    )

    orch.live_store = store
    orch.reconciler = reconciler
    orch.live_provider = provider
    orch.ingestion_worker = worker
