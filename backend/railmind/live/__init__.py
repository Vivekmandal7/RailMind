"""Live ingestion + reconciliation layer.

This package sits IN FRONT of the digital twin. It turns real running-status
reports (NTES-backed APIs, or an honest schedule-driven fallback) into:

  * a per-train delay baseline the twin folds into its arc-length motion model, and
  * a provenance tag (LIVE | INTERPOLATED | PREDICTED | SIM) on every train.

The single design principle: no inferred position is ever presented as truth.
Swap the upstream source by swapping one ``LiveStatusProvider`` class.
"""
from .interfaces import LiveReport, LiveStatusProvider, ORIGIN_LIVE, ORIGIN_SIM
from .store import LiveStore
from .reconciler import (
    Reconciler,
    Provenance,
    SOURCE_LIVE,
    SOURCE_INTERPOLATED,
    SOURCE_PREDICTED,
    SOURCE_SIM,
)
from .ingest import IngestionWorker

__all__ = [
    "LiveReport",
    "LiveStatusProvider",
    "ORIGIN_LIVE",
    "ORIGIN_SIM",
    "LiveStore",
    "Reconciler",
    "Provenance",
    "SOURCE_LIVE",
    "SOURCE_INTERPOLATED",
    "SOURCE_PREDICTED",
    "SOURCE_SIM",
    "IngestionWorker",
]
