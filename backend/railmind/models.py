"""Pydantic models = the typed contract shared between engine, transport and UI.

These are the ONLY shapes that cross the WebSocket / REST boundary. The
TypeScript types in ``frontend/lib/contract.ts`` mirror them 1:1.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

LngLat = tuple[float, float]


# --------------------------------------------------------------------------- #
# Static network (sent once over REST GET /network)
# --------------------------------------------------------------------------- #
class StationModel(BaseModel):
    code: str
    name: str
    lat: float
    lng: float
    platforms: int = 2


class SectionModel(BaseModel):
    id: str
    frm: str = Field(alias="from")
    to: str
    line: str  # "single" | "double"
    capacity: int
    ghat: bool = False
    geometry: list[LngLat]
    length_km: float
    # cumulative arc-length (km) at each polyline vertex
    cum_km: list[float]

    model_config = {"populate_by_name": True}


class TrainStaticModel(BaseModel):
    number: str
    name: str
    type: str  # "express" | "local"
    direction: str  # "UP" | "DOWN"
    coaches: int
    capacity_pax: int
    route: list[str]
    # flattened route polyline + arc-length so the FRONTEND can interpolate
    polyline: list[LngLat]
    cum_km: list[float]
    total_km: float


class NetworkModel(BaseModel):
    corridor_id: str
    corridor_name: str
    stations: list[StationModel]
    sections: list[SectionModel]
    trains: list[TrainStaticModel]


# --------------------------------------------------------------------------- #
# Live state (streamed over WebSocket)
# --------------------------------------------------------------------------- #
class TrainStatus(str, Enum):
    scheduled = "scheduled"
    running = "running"
    delayed = "delayed"
    held = "held"
    conflict = "conflict"
    arrived = "arrived"


class TrainStateModel(BaseModel):
    number: str
    status: TrainStatus
    active: bool
    # arc-length distance along route (km) -> frontend maps to position
    dist_km: float
    position: LngLat
    heading_deg: float
    speed_kmh: float
    delay_min: int
    next_station: Optional[str] = None
    prev_station: Optional[str] = None
    current_section: Optional[str] = None
    eta_next_sec: Optional[int] = None
    eta_final_sec: int
    est_passengers: int
    # provenance — the single design principle: every train says how it is known.
    source: str = "sim"               # live | interpolated | predicted | sim
    confidence: float = 0.4
    last_report_age_sec: Optional[int] = None


class Severity(str, Enum):
    critical = "critical"
    warning = "warning"
    info = "info"


class ConflictModel(BaseModel):
    id: str
    type: str  # headway | platform | congestion
    severity: Severity
    at_sec: int
    eta_sec: int
    location: str
    location_label: str
    trains: list[str]
    message: str
    passengers_affected: int
    connections_at_risk: int


class ResolutionActionModel(BaseModel):
    kind: str  # hold | reorder | reroute | speed
    train: str
    detail: str
    hold_sec: Optional[int] = None


class RecommendationModel(BaseModel):
    id: str
    conflict_id: str
    summary: str
    actions: list[ResolutionActionModel]
    delay_saved_min: int
    conflicts_resolved: int
    connections_protected: int
    passengers_protected: int
    verified: bool
    verify_note: str
    applied: bool = False
    explanation: str = ""
    verifier_agree: int = 0
    verifier_total: int = 0
    flagged_for_human: bool = False


class ModuleStatusModel(BaseModel):
    key: str
    name: str
    status: str  # idle | running | ok | flag | error | off
    last_action: str
    latency_ms: int
    detail: str


class PredictionModel(BaseModel):
    """Predictor output: projected delay per train (cascade)."""
    train: str
    predicted_delay_min: int
    cause: str


class AlertModel(BaseModel):
    id: str
    severity: Severity
    kind: str
    message: str
    at_sec: int
    countdown_sec: int
    trains: list[str]


class TimelineEventModel(BaseModel):
    id: str
    kind: str
    title: str
    detail: str
    severity: str
    sim_sec: float
    ref_id: str | None = None
    wall_ms: int = 0


class LiveStatusModel(BaseModel):
    """Data-spine health: what feed is driving the twin and how fresh it is.

    Powers the top-bar 'go live' clock ("NTES • updated 2m ago") and the
    provenance legend counts.
    """
    provider: str               # replay | rapidapi | ...
    origin: str                 # live | sim
    available: bool             # is a real feed actually flowing?
    updated_sec_ago: Optional[float] = None    # wall-clock age of freshest LIVE report
    live_count: int = 0                          # trains anchored to a real ping
    source_counts: dict[str, int] = {}           # {live, interpolated, predicted, sim}


class TwinSnapshot(BaseModel):
    """One broadcast frame. The heartbeat of the system."""
    corridor_id: str = ""
    sim_sec: float
    tick_hz: float
    time_scale: float
    autonomous: bool
    trains: list[TrainStateModel]
    conflicts: list[ConflictModel]
    recommendations: list[RecommendationModel]
    predictions: list[PredictionModel]
    alerts: list[AlertModel]
    disruptions: list[str]
    engine_modules: list[ModuleStatusModel] = []
    timeline: list[TimelineEventModel] = []
    live: Optional[LiveStatusModel] = None


# --------------------------------------------------------------------------- #
# REST request bodies
# --------------------------------------------------------------------------- #
class WhatIfRequest(BaseModel):
    command: str


class WhatIfResponse(BaseModel):
    ok: bool
    intent: str
    echo: str
    explanation: str


class ApplyPlanRequest(BaseModel):
    conflict_id: str


class AutonomousRequest(BaseModel):
    enabled: bool


class ControlRequest(BaseModel):
    playing: Optional[bool] = None
    time_scale: Optional[float] = None
    seek_sec: Optional[float] = None
