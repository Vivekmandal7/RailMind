"""FastAPI transport: WebSocket stream of the twin + REST for queries/commands.

The transport is a thin shell around the Orchestrator. It never contains
simulation logic — it advances the orchestrator on a fixed timer and broadcasts
the typed ``TwinSnapshot`` to all connected clients at ``tick_hz``.
"""
from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .config import build_orchestrator
from .models import (
    ApplyPlanRequest,
    AutonomousRequest,
    ControlRequest,
    NetworkModel,
    TrainStateModel,
    TwinSnapshot,
    WhatIfRequest,
    WhatIfResponse,
)

CONFIG_PATH = os.environ.get(
    "RAILMIND_CONFIG",
    str(Path(__file__).resolve().parent.parent / "config" / "india_wide.yaml"),
)

app = FastAPI(title="RailMind Engine", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

orch = build_orchestrator(CONFIG_PATH)


class Hub:
    """Tracks connected WebSocket clients and broadcasts snapshots."""

    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    async def broadcast(self, payload: str) -> None:
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


hub = Hub()


async def sim_loop() -> None:
    """Fast loop: advance the clock + broadcast train positions every tick.

    Stays lightweight so the WebSocket and /health never stall — even while the
    brain is busy calling CP-SAT and the LLM verifier. (Previously the heavy
    pipeline ran here and could freeze the loop for seconds when LLM keys were
    set, making the UI drop to its LOCAL fallback.)"""
    tick_hz = getattr(orch, "tick_hz", 5.0)
    dt = 1.0 / tick_hz
    last = time.perf_counter()
    while True:
        now = time.perf_counter()
        real_dt = now - last
        last = now
        orch.advance(real_dt)
        if hub.clients:
            snap = orch.snapshot()
            snap.tick_hz = tick_hz
            await hub.broadcast(snap.model_dump_json())
        await asyncio.sleep(dt)


async def brain_loop() -> None:
    """Heavy loop: run detect → optimize → verify → explain OFF the event loop.

    asyncio.to_thread keeps the (sometimes multi-second, blocking) CP-SAT + LLM
    work from starving the transport. The orchestrator caches plans, so an
    unchanged conflict won't re-hit the LLMs on every pass."""
    while True:
        try:
            await asyncio.to_thread(orch.run_pipeline)
        except Exception as exc:  # one bad pass never kills the brain
            print("[brain]", repr(exc))
        await asyncio.sleep(1.5)


@app.on_event("startup")
async def _startup() -> None:
    asyncio.create_task(sim_loop())
    asyncio.create_task(brain_loop())
    worker = getattr(orch, "ingestion_worker", None)
    if worker is not None:
        asyncio.create_task(worker.run())


# ----------------------------- REST ---------------------------------------- #
@app.get("/health")
def health() -> dict:
    from . import llm
    from .forecaster import GBMDelayForecaster
    fc = GBMDelayForecaster()
    providers = llm.available_providers()
    lp = getattr(orch, "live_provider", None)
    store = getattr(orch, "live_store", None)
    return {
        "status": "ok",
        "corridor": orch.corridor_name,
        "trains": len(orch.net.trains),
        "sim_sec": orch.sim_sec,
        "tick_hz": getattr(orch, "tick_hz", 5.0),
        "llm_enabled": len(providers) > 0,
        "llm_providers": [p.label for p in providers],
        "delay_model": fc.kind,
        "optimizer": type(orch.optimizer).__name__,
        "verifier": type(orch.verifier).__name__,
        "live_provider": lp.name if lp else None,
        "live_origin": lp.origin if lp else None,
        "live_available": bool(lp.available()) if lp else False,
        "live_updated_sec_ago": store.newest_live_age_sec() if store else None,
    }


@app.get("/network", response_model=NetworkModel)
def network() -> NetworkModel:
    return orch.network_model()


@app.get("/snapshot", response_model=TwinSnapshot)
def snapshot() -> TwinSnapshot:
    snap = orch.snapshot()
    snap.tick_hz = getattr(orch, "tick_hz", 5.0)
    return snap


@app.get("/train/{number}", response_model=TrainStateModel)
def train(number: str):
    states = orch.twin.compute_states(orch.ctx())
    st = next((s for s in states if s.number == number), None)
    if st is None:
        return TrainStateModel(
            number=number, status="scheduled", active=False, dist_km=0, position=(0, 0),
            heading_deg=0, speed_kmh=0, delay_min=0, eta_final_sec=0, est_passengers=0,
        )
    return orch._train_model(st)


@app.post("/whatif", response_model=WhatIfResponse)
def whatif(req: WhatIfRequest) -> WhatIfResponse:
    intent, echo, explanation = orch.run_whatif(req.command)
    return WhatIfResponse(ok=intent != "unknown", intent=intent, echo=echo, explanation=explanation)


@app.post("/apply")
def apply(req: ApplyPlanRequest) -> dict:
    return {"applied": orch.apply_plan(req.conflict_id)}


@app.post("/autonomous")
def autonomous(req: AutonomousRequest) -> dict:
    orch.set_autonomous(req.enabled)
    return {"autonomous": orch.autonomous}


@app.post("/inject/{kind}")
def inject(kind: str, train: str | None = None, section: str | None = None) -> dict:
    if kind == "breakdown":
        orch.inject_breakdown(train)
    elif kind == "block":
        orch.inject_block(section)
    elif kind == "fog":
        orch.inject_fog()
    elif kind == "clear":
        orch.clear_disruptions()
    else:
        return {"ok": False, "error": "unknown kind"}
    return {"ok": True}


@app.post("/control")
def control(req: ControlRequest) -> dict:
    if req.playing is not None:
        orch.set_playing(req.playing)
    if req.time_scale is not None:
        orch.set_time_scale(req.time_scale)
    if req.seek_sec is not None:
        orch.seek(req.seek_sec)
    return {"playing": orch.playing, "time_scale": orch.time_scale, "sim_sec": orch.sim_sec}


# ----------------------------- WebSocket ----------------------------------- #
@app.websocket("/stream")
async def stream(ws: WebSocket) -> None:
    await hub.connect(ws)
    try:
        # send an immediate snapshot so the client paints without waiting a tick
        snap = orch.snapshot()
        snap.tick_hz = getattr(orch, "tick_hz", 5.0)
        await ws.send_text(snap.model_dump_json())
        while True:
            # client may send control commands over the same socket
            msg = await ws.receive_text()
            await _handle_ws_command(msg)
    except WebSocketDisconnect:
        hub.disconnect(ws)
    except Exception:
        hub.disconnect(ws)


async def _handle_ws_command(msg: str) -> None:
    import json

    try:
        data = json.loads(msg)
    except Exception:
        return
    action = data.get("action")
    if action == "control":
        if "playing" in data:
            orch.set_playing(bool(data["playing"]))
        if "time_scale" in data:
            orch.set_time_scale(float(data["time_scale"]))
        if "seek_sec" in data:
            orch.seek(float(data["seek_sec"]))
    elif action == "apply":
        orch.apply_plan(data.get("conflict_id", ""))
    elif action == "autonomous":
        orch.set_autonomous(bool(data.get("enabled", False)))
    elif action == "inject":
        kind = data.get("kind")
        if kind == "breakdown":
            orch.inject_breakdown(data.get("train"))
        elif kind == "block":
            orch.inject_block(data.get("section"))
        elif kind == "fog":
            orch.inject_fog()
        elif kind == "clear":
            orch.clear_disruptions()
    elif action == "whatif":
        orch.run_whatif(data.get("command", ""))
