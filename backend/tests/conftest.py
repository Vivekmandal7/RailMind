from pathlib import Path

import pytest

from railmind.config import build_orchestrator
from railmind.datasource import GeoJSONDataSource
from railmind.network import NetworkGraph
from railmind.twin import DigitalTwin

CONFIG = Path(__file__).resolve().parent.parent / "config" / "mumbai_csmt_igatpuri.yaml"
BASE = Path(__file__).resolve().parent.parent


@pytest.fixture
def source() -> GeoJSONDataSource:
    return GeoJSONDataSource(
        "../data/stations.geojson",
        "../data/sections.geojson",
        "../data/timetable.json",
        base=CONFIG.parent,
    )


@pytest.fixture
def net(source) -> NetworkGraph:
    return NetworkGraph(source)


@pytest.fixture
def twin(net) -> DigitalTwin:
    return DigitalTwin(net)


@pytest.fixture
def orch():
    return build_orchestrator(CONFIG)
