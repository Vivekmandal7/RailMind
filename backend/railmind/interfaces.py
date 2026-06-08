"""Engine interfaces. Every pluggable stage is an ABC.

Future implementations (live API DataSource, ML Predictor, OR-Tools Optimizer,
LLM-consensus Verifier) subclass these and are injected by the Orchestrator —
no module reaches into another's internals. See ``docs/EXTENDING.md``.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional


# --------------------------------------------------------------------------- #
# Plain engine-internal dataclasses (the in-process state the modules share).
# Pydantic models in models.py are the *wire* contract; these are the *runtime*
# contract. Keeping them separate means modules never depend on transport.
# --------------------------------------------------------------------------- #
@dataclass
class Station:
    code: str
    name: str
    lat: float
    lng: float
    platforms: int


@dataclass
class Section:
    id: str
    frm: str
    to: str
    line: str
    capacity: int
    ghat: bool
    geometry: list[tuple[float, float]]
    cum_km: list[float]
    length_km: float


@dataclass
class ScheduleStop:
    station: str
    arr: int  # sec from midnight
    dep: int


@dataclass
class Train:
    number: str
    name: str
    type: str
    direction: str
    coaches: int
    capacity_pax: int
    route: list[str]
    schedule: list[ScheduleStop]
    cum_dist_km: list[float]          # arc-length at each route station
    polyline: list[tuple[float, float]]
    poly_cum_km: list[float]
    total_km: float


@dataclass
class TrainState:
    number: str
    name: str
    type: str
    direction: str
    status: str
    active: bool
    dist_km: float
    position: tuple[float, float]
    heading_deg: float
    speed_kmh: float
    delay_min: int
    next_station: Optional[str]
    prev_station: Optional[str]
    current_section: Optional[str]
    eta_next_sec: Optional[int]
    eta_final_sec: int
    est_passengers: int


@dataclass
class Conflict:
    id: str
    type: str
    severity: str
    at_sec: int
    eta_sec: int
    location: str
    location_label: str
    trains: list[str]
    message: str
    passengers_affected: int
    connections_at_risk: int


@dataclass
class ResolutionAction:
    kind: str
    train: str
    detail: str
    hold_sec: Optional[int] = None


@dataclass
class ResolutionPlan:
    id: str
    conflict_id: str
    summary: str
    actions: list[ResolutionAction]
    delay_saved_min: int
    conflicts_resolved: int
    connections_protected: int
    passengers_protected: int
    verified: bool
    verify_note: str
    applied: bool = False


@dataclass
class Prediction:
    train: str
    predicted_delay_min: int
    cause: str


@dataclass
class Disruption:
    id: str
    kind: str  # breakdown | block | fog | delay
    label: str
    train: Optional[str] = None
    section: Optional[str] = None
    speed_factor: Optional[float] = None
    add_min: Optional[int] = None
    frozen_dist_km: Optional[float] = None
    at_sec: float = 0.0


@dataclass
class SimContext:
    """Everything a module needs to reason about the network at an instant."""
    sim_sec: float
    delays_sec: dict[str, float] = field(default_factory=dict)
    frozen: dict[str, float] = field(default_factory=dict)
    blocked: set[str] = field(default_factory=set)
    speed_factor: float = 1.0


# --------------------------------------------------------------------------- #
# Interfaces
# --------------------------------------------------------------------------- #
class DataSource(ABC):
    """Loads the static corridor: stations, sections, trains/schedules."""

    @abstractmethod
    def load_stations(self) -> list[Station]: ...

    @abstractmethod
    def load_sections(self) -> list[Section]: ...

    @abstractmethod
    def load_trains(
        self, stations: dict[str, Station], sections: dict[str, Section]
    ) -> list[Train]: ...


class ConflictDetector(ABC):
    """Finds conflicts over the live + look-ahead network state."""

    @abstractmethod
    def detect(self, twin: "DigitalTwinProto", ctx: SimContext) -> list[Conflict]: ...


class Predictor(ABC):
    """Projects future delay (cascade / ML)."""

    @abstractmethod
    def predict(
        self, twin: "DigitalTwinProto", states: list[TrainState], ctx: SimContext
    ) -> list[Prediction]: ...


class Optimizer(ABC):
    """Proposes a resolution plan for a conflict."""

    @abstractmethod
    def propose(
        self, twin: "DigitalTwinProto", conflict: Conflict, states: list[TrainState]
    ) -> ResolutionPlan: ...


class Verifier(ABC):
    """Checks a plan is safe/feasible before it is applied."""

    @abstractmethod
    def verify(
        self, twin: "DigitalTwinProto", plan: ResolutionPlan, conflict: Conflict
    ) -> tuple[bool, str]: ...


class DigitalTwinProto(ABC):
    """Minimal surface the modules rely on (avoids tight coupling to the impl)."""

    @abstractmethod
    def compute_states(self, ctx: SimContext) -> list[TrainState]: ...

    @property
    @abstractmethod
    def trains(self) -> list[Train]: ...

    @abstractmethod
    def station(self, code: str) -> Optional[Station]: ...

    @abstractmethod
    def section(self, sid: str) -> Optional[Section]: ...
