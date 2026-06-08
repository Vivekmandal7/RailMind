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


class TwinSnapshot(BaseModel):
    """One broadcast frame. The heartbeat of the system."""
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
