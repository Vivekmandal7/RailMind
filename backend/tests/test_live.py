"""Tests for the live ingestion + reconciliation spine (P0).

Covers: provider parsing, replay synthesis, store TTL/freshness, the provenance
state machine (LIVE/INTERPOLATED/PREDICTED/SIM), delay fold-in, and the honest
no-key fallback to schedule-driven SIM.
"""
import asyncio
import time
from pathlib import Path

from railmind.config import build_orchestrator
from railmind.live import (
    LiveStore,
    Reconciler,
    SOURCE_INTERPOLATED,
    SOURCE_LIVE,
    SOURCE_PREDICTED,
    SOURCE_SIM,
)
from railmind.live.interfaces import LiveReport, ORIGIN_LIVE, ORIGIN_SIM
from railmind.live.ingest import IngestionWorker
from railmind.live.providers.rapidapi import RapidApiProvider
from railmind.live.providers.replay import ReplayProvider

CONFIG = Path(__file__).resolve().parent.parent / "config" / "mumbai_csmt_igatpuri.yaml"


# --------------------------------------------------------------------------- #
# Replay provider — schedule-driven synthesis
# --------------------------------------------------------------------------- #
def test_replay_provider_reports_segment(net):
    prov = ReplayProvider(net, clock_fn=lambda: net.trains[0].schedule[0].dep + 60)
    rep = asyncio.run(prov.fetch(net.trains[0].number))
    assert rep is not None
    assert rep.origin == ORIGIN_SIM
    assert rep.delay_min == 0
    assert rep.last_station is not None  # has departed its origin


def test_replay_provider_unknown_train_is_none(net):
    prov = ReplayProvider(net, clock_fn=lambda: 0.0)
    assert asyncio.run(prov.fetch("00000")) is None


# --------------------------------------------------------------------------- #
# RapidAPI provider — parsing is tolerant and key-gated
# --------------------------------------------------------------------------- #
def test_rapidapi_unavailable_without_key(net, monkeypatch):
    monkeypatch.delenv("RAILMIND_RAPIDAPI_KEY", raising=False)
    prov = RapidApiProvider(net)
    assert prov.available() is False
    assert asyncio.run(prov.fetch(net.trains[0].number)) is None


def test_rapidapi_parses_live_payload(net):
    """Real indian-railway-irctc shape: delay = actual − scheduled at current stop."""
    prov = RapidApiProvider(net)
    payload = {
        "error": None,
        "body": {
            "current_station": "SWV",
            "terminated": False,
            "train_status_message": "Train has crossed Madure at 13:19",
            "stations": [
                {"stationCode": "KUDL", "arrivalTime": "12:30", "actual_arrival_time": "12:56"},
                {"stationCode": "SWV", "arrivalTime": "12:50", "actual_arrival_time": "13:14"},
                {"stationCode": "THVM", "arrivalTime": "13:20", "actual_arrival_time": "13:39"},
                {"stationCode": "MAO", "arrivalTime": "14:30", "actual_arrival_time": "14:37"},
            ],
        },
    }
    rep = prov.parse(payload, "12051")
    assert rep is not None
    assert rep.origin == ORIGIN_LIVE
    assert rep.delay_min == 24                 # 12:50 -> 13:14
    assert rep.last_station == "SWV"
    assert rep.next_station == "THVM"
    assert rep.eta_next_sec == 13 * 3600 + 39 * 60   # projected ETA


def test_rapidapi_parse_terminated_has_no_next(net):
    prov = RapidApiProvider(net)
    payload = {
        "body": {
            "current_station": "MAO",
            "terminated": True,
            "stations": [
                {"stationCode": "SWV", "arrivalTime": "12:50", "actual_arrival_time": "13:14"},
                {"stationCode": "MAO", "arrivalTime": "14:30", "actual_arrival_time": "14:37"},
            ],
        },
    }
    rep = prov.parse(payload, "12051")
    assert rep.delay_min == 7
    assert rep.next_station is None


def test_rapidapi_parse_handles_garbage(net):
    prov = RapidApiProvider(net)
    # unexpected/empty shapes must not raise — they yield None, never a fake report
    assert prov.parse({"nonsense": True}, "12137") is None
    assert prov.parse([], "12137") is None
    assert prov.parse({"body": {}}, "12137") is None
    assert prov.parse({"body": {"stations": []}}, "12137") is None


# --------------------------------------------------------------------------- #
# Store — TTL + freshness
# --------------------------------------------------------------------------- #
def test_store_ttl_expiry():
    store = LiveStore(ttl_sec=100)
    now = time.time()
    store.put(LiveReport("12137", 5, "A", "B", None, now - 200, origin=ORIGIN_LIVE))
    assert store.get("12137", now=now) is None      # expired
    store.put(LiveReport("12137", 5, "A", "B", None, now - 10, origin=ORIGIN_LIVE))
    assert store.get("12137", now=now) is not None


def test_store_newest_live_age_ignores_sim():
    store = LiveStore()
    now = time.time()
    store.put(LiveReport("1", 0, "A", "B", None, now - 5, origin=ORIGIN_SIM))
    assert store.newest_live_age_sec(now=now) is None   # no real feed
    store.put(LiveReport("2", 7, "A", "B", None, now - 30, origin=ORIGIN_LIVE))
    assert abs(store.newest_live_age_sec(now=now) - 30) < 1


# --------------------------------------------------------------------------- #
# Reconciler — provenance state machine
# --------------------------------------------------------------------------- #
def _store_with(age_sec, origin):
    store = LiveStore()
    now = time.time()
    store.put(LiveReport("12137", 12, "A", "B", None, now - age_sec, origin=origin))
    return store, now


def test_provenance_live_when_fresh():
    store, now = _store_with(30, ORIGIN_LIVE)
    rec = Reconciler(store, fresh_window_sec=180, stale_window_sec=900)
    assert rec.provenance("12137", now=now).source == SOURCE_LIVE


def test_provenance_interpolated_when_between_pings():
    store, now = _store_with(400, ORIGIN_LIVE)
    rec = Reconciler(store, fresh_window_sec=180, stale_window_sec=900)
    p = rec.provenance("12137", now=now)
    assert p.source == SOURCE_INTERPOLATED
    assert 0.4 <= p.confidence <= 0.8


def test_provenance_predicted_when_stale():
    store, now = _store_with(1200, ORIGIN_LIVE)
    rec = Reconciler(store, fresh_window_sec=180, stale_window_sec=900)
    assert rec.provenance("12137", now=now).source == SOURCE_PREDICTED


def test_provenance_sim_for_replay_and_missing():
    store, now = _store_with(10, ORIGIN_SIM)
    rec = Reconciler(store, fresh_window_sec=180, stale_window_sec=900)
    assert rec.provenance("12137", now=now).source == SOURCE_SIM
    assert rec.provenance("99999", now=now).source == SOURCE_SIM   # no report


def test_reconciler_live_delays_fold_in():
    store = LiveStore()
    now = time.time()
    store.put(LiveReport("12137", 15, "A", "B", None, now, origin=ORIGIN_LIVE))
    store.put(LiveReport("12138", 0, "A", "B", None, now, origin=ORIGIN_SIM))
    rec = Reconciler(store)
    delays = rec.live_delays(now=now)
    assert delays["12137"] == 15 * 60
    assert "12138" not in delays      # on-schedule SIM doesn't perturb motion


# --------------------------------------------------------------------------- #
# Ingestion worker — quota safety
# --------------------------------------------------------------------------- #
def test_worker_caps_polled_trains_for_quota(net):
    prov = ReplayProvider(net, clock_fn=lambda: 0.0)
    nums = [t.number for t in net.trains]
    worker = IngestionWorker(prov, LiveStore(), nums, max_trains=3)
    assert len(worker.numbers) == 3            # rest stay SIM, never polled
    assert worker.numbers == nums[:3]


# --------------------------------------------------------------------------- #
# Orchestrator — end to end
# --------------------------------------------------------------------------- #
def test_orchestrator_attaches_live_layer_and_falls_back(monkeypatch):
    monkeypatch.delenv("RAILMIND_RAPIDAPI_KEY", raising=False)
    orch = build_orchestrator(CONFIG)
    # config asks for rapidapi; with no key it must honestly degrade to replay
    assert orch.live_provider is not None
    assert orch.live_provider.name == "replay"
    assert orch.reconciler is not None
    assert orch.ingestion_worker is not None


def test_snapshot_carries_provenance_and_freshness(monkeypatch):
    monkeypatch.delenv("RAILMIND_RAPIDAPI_KEY", raising=False)
    orch = build_orchestrator(CONFIG)
    for _ in range(5):
        orch.step(0.2)
    snap = orch.snapshot()
    assert snap.live is not None
    assert snap.live.provider == "replay"
    assert snap.live.origin == "sim"
    # every train carries a provenance tag; with no real feed all are SIM
    assert snap.trains
    assert all(t.source in {"live", "interpolated", "predicted", "sim"} for t in snap.trains)
    assert snap.live.updated_sec_ago is None      # no real feed -> honest null


def test_live_report_shifts_train_position(monkeypatch):
    """A real fresh ping with delay folds into the twin and tags the train LIVE."""
    monkeypatch.delenv("RAILMIND_RAPIDAPI_KEY", raising=False)
    orch = build_orchestrator(CONFIG)
    orch.step(0.2)
    target = next(t for t in orch.snapshot().trains if t.active)
    before = next(s for s in orch.twin.compute_states(orch.ctx()) if s.number == target.number)

    orch.live_store.put(LiveReport(
        target.number, 20, None, None, None, time.time(), origin=ORIGIN_LIVE,
    ))
    orch.step(0.2)
    snap = orch.snapshot()
    tagged = next(t for t in snap.trains if t.number == target.number)
    after = next(s for s in orch.twin.compute_states(orch.ctx()) if s.number == target.number)

    assert tagged.source == SOURCE_LIVE
    assert tagged.delay_min >= 19           # 20-min live delay reflected
    # a 20-min delay shifts the train back along its route (or holds at origin)
    assert after.dist_km <= before.dist_km + 1e-6
