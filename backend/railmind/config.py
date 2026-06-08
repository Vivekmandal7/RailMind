"""Config-driven assembly + dependency injection.

The corridor, sim parameters and which module implementation to use for each
stage are all read from a YAML file. Registries map a config string to an
implementation, so a half-built module can be toggled on/off without code
changes (feature flags).
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable

import yaml

from .datasource import GeoJSONDataSource
from .detectors import RuleBasedConflictDetector
from .geo import parse_hhmm
from .interfaces import ConflictDetector, DataSource, Optimizer, Predictor, Verifier
from .network import NetworkGraph
from .optimizer import GreedyOptimizer
from .orchestrator import Orchestrator
from .predictor import DelayCascadePredictor
from .twin import DigitalTwin
from .verifier import RuleBasedVerifier

# ---- module registries (the swap points) --------------------------------- #
DATA_SOURCES: dict[str, Callable[..., DataSource]] = {
    "geojson": GeoJSONDataSource,
}
DETECTORS: dict[str, Callable[..., ConflictDetector]] = {
    "rule_based": RuleBasedConflictDetector,
}
PREDICTORS: dict[str, Callable[..., Predictor]] = {
    "cascade": DelayCascadePredictor,
}
OPTIMIZERS: dict[str, Callable[..., Optimizer]] = {
    "greedy": GreedyOptimizer,
}
VERIFIERS: dict[str, Callable[..., Verifier]] = {
    "rule_based": RuleBasedVerifier,
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
    predictor = PREDICTORS[mods.get("predictor", "cascade")]()
    optimizer = OPTIMIZERS[mods.get("optimizer", "greedy")]()
    verifier = VERIFIERS[mods.get("verifier", "rule_based")]()

    sim = cfg.get("simulation", {})
    start_clock = sim.get("start_clock")
    start_sec = parse_hhmm(start_clock) if start_clock else None

    orch = Orchestrator(
        net, twin, detector, predictor, optimizer, verifier,
        time_scale=float(sim.get("time_scale", 60.0)),
        start_clock_sec=start_sec,
        loop=bool(sim.get("loop", True)),
        autonomous=bool(mods.get("autonomous", False)),
    )
    corridor = cfg.get("corridor", {})
    orch.corridor_id = corridor.get("id", "corridor")
    orch.corridor_name = corridor.get("name", "Corridor")
    orch.tick_hz = float(sim.get("tick_hz", 5))
    return orch
