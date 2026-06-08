"""Orchestrator: wires the loop.

    tick -> detect -> predict -> (if disruption) optimize -> verify -> apply -> broadcast

It owns the mutable simulation state (clock, disruptions, applied plans) and the
injected module implementations. Heavy analysis (detect/predict/optimize) is
throttled to keep the broadcast light while train states stream every tick.
"""
from __future__ import annotations

import time
import uuid
from dataclasses import replace

from . import nl
from .interfaces import (
    Conflict,
    ConflictDetector,
    Disruption,
    Optimizer,
    Predictor,
    ResolutionPlan,
    SimContext,
    Verifier,
)
from .models import (
    AlertModel,
    ConflictModel,
    NetworkModel,
    PredictionModel,
    RecommendationModel,
    ResolutionActionModel,
    SectionModel,
    StationModel,
    TrainStateModel,
    TrainStaticModel,
    TwinSnapshot,
)
from .network import NetworkGraph
from .twin import DigitalTwin


class Orchestrator:
    def __init__(
        self,
        net: NetworkGraph,
        twin: DigitalTwin,
        detector: ConflictDetector,
        predictor: Predictor,
        optimizer: Optimizer,
        verifier: Verifier,
        *,
        time_scale: float = 60.0,
        start_clock_sec: float | None = None,
        loop: bool = True,
        autonomous: bool = False,
        detect_interval_sec: float = 1.0,
    ):
        self.net = net
        self.twin = twin
        self.detector = detector
        self.predictor = predictor
        self.optimizer = optimizer
        self.verifier = verifier

        self.time_scale = time_scale
        self.loop = loop
        self.autonomous = autonomous
        self.detect_interval = detect_interval_sec

        self.window_start, self.window_end = self._compute_window()
        self.sim_sec = start_clock_sec if start_clock_sec is not None else self.window_start
        self.playing = True

        # mutable disruption state
        self.delays_sec: dict[str, float] = {}
        self.frozen: dict[str, float] = {}
        self.blocked: set[str] = set()
        self.speed_factor: float = 1.0
        self.disruptions: list[Disruption] = []

        self.applied_ids: set[str] = set()
        self.applied_plans: list[ResolutionPlan] = []

        # cached heavy analysis
        self._last_detect_sim = -1e9
        self._conflicts: list[Conflict] = []
        self._plans: list[ResolutionPlan] = []
        self._predictions = []

    # ------------------------------------------------------------------ #
    def _compute_window(self) -> tuple[float, float]:
        start = min(t.schedule[0].dep for t in self.net.trains) - 120
        end = max(t.schedule[-1].arr for t in self.net.trains) + 300
        return start, end

    def ctx(self) -> SimContext:
        return SimContext(
            sim_sec=self.sim_sec,
            delays_sec=self.delays_sec,
            frozen=self.frozen,
            blocked=self.blocked,
            speed_factor=self.speed_factor,
        )

    # ------------------------------------------------------------------ #
    def step(self, real_dt: float) -> None:
        if self.playing:
            self.sim_sec += real_dt * self.time_scale
            if self.sim_sec >= self.window_end:
                self.sim_sec = self.window_start if self.loop else self.window_end
        self._run_pipeline()

    def _run_pipeline(self) -> None:
        if self.sim_sec - self._last_detect_sim < self.detect_interval * self.time_scale \
                and self.sim_sec >= self._last_detect_sim:
            return
        self._last_detect_sim = self.sim_sec
        ctx = self.ctx()
        states = self.twin.compute_states(ctx)
        self._conflicts = self.detector.detect(self.twin, ctx)
        self._predictions = self.predictor.predict(self.twin, states, ctx)
        plans: list[ResolutionPlan] = []
        for c in self._conflicts:
            plan = self.optimizer.propose(self.twin, c, states)
            ok, note = self.verifier.verify(self.twin, plan, c)
            plan.verified = ok
            plan.verify_note = note
            plan.applied = c.id in self.applied_ids
            plans.append(plan)
        self._plans = plans

        if self.autonomous:
            for c in self._conflicts:
                if c.severity == "critical" and c.id not in self.applied_ids:
                    plan = next((p for p in plans if p.conflict_id == c.id and p.verified), None)
                    if plan:
                        self._apply(plan)
                        break

    # ------------------------------------------------------------------ #
    def snapshot(self) -> TwinSnapshot:
        ctx = self.ctx()
        states = self.twin.compute_states(ctx)
        alerts = self._build_alerts(self._conflicts, states)
        return TwinSnapshot(
            sim_sec=self.sim_sec,
            tick_hz=0,  # filled by transport
            time_scale=self.time_scale,
            autonomous=self.autonomous,
            trains=[self._train_model(s) for s in states],
            conflicts=[self._conflict_model(c) for c in self._conflicts],
            recommendations=[self._rec_model(p) for p in self._plans],
            predictions=[PredictionModel(train=p.train, predicted_delay_min=p.predicted_delay_min, cause=p.cause) for p in self._predictions],
            alerts=alerts,
            disruptions=[d.label for d in self.disruptions],
        )

    # ---- control -------------------------------------------------------- #
    def set_playing(self, playing: bool) -> None:
        self.playing = playing

    def set_time_scale(self, ts: float) -> None:
        self.time_scale = max(1.0, ts)

    def seek(self, sec: float) -> None:
        self.sim_sec = max(self.window_start, min(self.window_end, sec))
        self._last_detect_sim = -1e9
        self._run_pipeline()

    def set_autonomous(self, enabled: bool) -> None:
        self.autonomous = enabled

    # ---- plan application ---------------------------------------------- #
    def apply_plan(self, conflict_id: str) -> bool:
        plan = next((p for p in self._plans if p.conflict_id == conflict_id), None)
        if plan is None:
            return False
        self._apply(plan)
        return True

    def _apply(self, plan: ResolutionPlan) -> None:
        for a in plan.actions:
            if a.hold_sec and a.kind != "speed":
                self.delays_sec[a.train] = self.delays_sec.get(a.train, 0.0) + a.hold_sec
        self.applied_ids.add(plan.conflict_id)
        plan.applied = True
        self.applied_plans.insert(0, plan)
        self.applied_plans = self.applied_plans[:12]
        self._last_detect_sim = -1e9  # force re-analysis next tick

    # ---- disruptions ---------------------------------------------------- #
    def inject_breakdown(self, train: str | None = None) -> None:
        states = self.twin.compute_states(self.ctx())
        if train is None:
            cands = [s for s in states if s.active and s.speed_kmh > 0]
            cands.sort(key=lambda s: s.est_passengers, reverse=True)
            train = cands[0].number if cands else None
        if not train:
            return
        st = next((s for s in states if s.number == train), None)
        if st is None:
            return
        self.frozen[train] = st.dist_km
        self.disruptions.append(Disruption(id=str(uuid.uuid4()), kind="breakdown",
                                            label=f"Breakdown: {train}", train=train,
                                            frozen_dist_km=st.dist_km, at_sec=self.sim_sec))
        self._last_detect_sim = -1e9

    def inject_block(self, section_id: str | None = None) -> None:
        sec_id = section_id or "KSRA-IGP"
        self.blocked.add(sec_id)
        sec = self.net.section(sec_id)
        label = f"{sec.frm}\u2013{sec.to}" if sec else sec_id
        self.disruptions.append(Disruption(id=str(uuid.uuid4()), kind="block",
                                            label=f"Block: {label}", section=sec_id, at_sec=self.sim_sec))
        self._last_detect_sim = -1e9

    def inject_block_path(self, frm: str, to: str) -> None:
        path = self.net.shortest_path(frm, to)
        if len(path) < 2:
            return
        for i in range(len(path) - 1):
            self.blocked.add(f"{path[i]}-{path[i + 1]}")
        a = self.net.station(frm)
        b = self.net.station(to)
        label = f"{a.code if a else frm}\u2013{b.code if b else to}"
        self.disruptions.append(Disruption(id=str(uuid.uuid4()), kind="block",
                                            label=f"Block: {label}", at_sec=self.sim_sec))
        self._last_detect_sim = -1e9

    def inject_fog(self) -> None:
        self.speed_factor = 0.6
        self.disruptions.append(Disruption(id=str(uuid.uuid4()), kind="fog",
                                            label="Fog: speed restriction",
                                            speed_factor=0.6, at_sec=self.sim_sec))
        self._last_detect_sim = -1e9

    def inject_delay(self, train: str, add_min: int) -> None:
        self.delays_sec[train] = self.delays_sec.get(train, 0.0) + add_min * 60
        self.disruptions.append(Disruption(id=str(uuid.uuid4()), kind="delay",
                                            label=f"+{add_min}m {train}", train=train,
                                            add_min=add_min, at_sec=self.sim_sec))
        self._last_detect_sim = -1e9

    def clear_disruptions(self) -> None:
        self.delays_sec.clear()
        self.frozen.clear()
        self.blocked.clear()
        self.speed_factor = 1.0
        self.disruptions.clear()
        self.applied_ids.clear()
        self.applied_plans.clear()
        self._last_detect_sim = -1e9

    # ---- what-if -------------------------------------------------------- #
    def run_whatif(self, command: str) -> tuple[str, str, str]:
        intent = nl.parse_command(command, self.net)
        echo = nl.echo(intent)
        if intent.type == "delay":
            self.inject_delay(intent.train, intent.add_min)
        elif intent.type == "breakdown":
            self.inject_breakdown(intent.train)
        elif intent.type == "block":
            if intent.section:
                self.inject_block(intent.section)
            elif intent.frm and intent.to:
                self.inject_block_path(intent.frm, intent.to)
        elif intent.type == "fog":
            self.inject_fog()
        elif intent.type == "clear":
            self.clear_disruptions()
        self._last_detect_sim = -1e9
        self._run_pipeline()
        explanation = self._explain(intent)
        return intent.type, echo, explanation

    def _explain(self, intent) -> str:
        if intent.type == "unknown":
            return nl.echo(intent)
        crit = sum(1 for c in self._conflicts if c.severity == "critical")
        pax = sum(c.passengers_affected for c in self._conflicts)
        top = self._plans[0] if self._plans else None
        head = {
            "delay": f"+{intent.add_min} min on {intent.train} ripples forward.",
            "block": f"Closing {intent.label} forces traffic onto remaining capacity.",
            "breakdown": f"{intent.train} stalls and blocks its section.",
            "fog": "Fog slows every service; running times stretch.",
            "clear": "All disruptions cleared; network returning to plan.",
        }.get(intent.type, "")
        risk = (f"Projected {len(self._conflicts)} conflict(s) ({crit} critical) affecting "
                f"~{pax:,} passengers." if self._conflicts else
                "No new conflicts projected in the look-ahead window.")
        rec = (f"Recommended: {top.summary} Est. {top.delay_saved_min} min saved, "
               f"{top.passengers_protected:,} passengers protected." if top else
               "No intervention required.")
        return f"{head} {risk} {rec}"

    # ---- model conversion ---------------------------------------------- #
    def network_model(self) -> NetworkModel:
        return NetworkModel(
            corridor_id=getattr(self, "corridor_id", "corridor"),
            corridor_name=getattr(self, "corridor_name", "Corridor"),
            stations=[StationModel(code=s.code, name=s.name, lat=s.lat, lng=s.lng, platforms=s.platforms)
                      for s in self.net.stations.values()],
            sections=[SectionModel(id=s.id, frm=s.frm, to=s.to, line=s.line, capacity=s.capacity,
                                   ghat=s.ghat, geometry=s.geometry, length_km=s.length_km, cum_km=s.cum_km)
                      for s in self.net.section_list],
            trains=[TrainStaticModel(number=t.number, name=t.name, type=t.type, direction=t.direction,
                                     coaches=t.coaches, capacity_pax=t.capacity_pax, route=t.route,
                                     polyline=t.polyline, cum_km=t.poly_cum_km, total_km=t.total_km)
                    for t in self.net.trains],
        )

    @staticmethod
    def _train_model(s) -> TrainStateModel:
        return TrainStateModel(
            number=s.number, status=s.status, active=s.active, dist_km=s.dist_km,
            position=s.position, heading_deg=s.heading_deg, speed_kmh=s.speed_kmh,
            delay_min=s.delay_min, next_station=s.next_station, prev_station=s.prev_station,
            current_section=s.current_section, eta_next_sec=s.eta_next_sec,
            eta_final_sec=s.eta_final_sec, est_passengers=s.est_passengers,
        )

    @staticmethod
    def _conflict_model(c) -> ConflictModel:
        return ConflictModel(
            id=c.id, type=c.type, severity=c.severity, at_sec=c.at_sec, eta_sec=c.eta_sec,
            location=c.location, location_label=c.location_label, trains=c.trains,
            message=c.message, passengers_affected=c.passengers_affected,
            connections_at_risk=c.connections_at_risk,
        )

    @staticmethod
    def _rec_model(p) -> RecommendationModel:
        return RecommendationModel(
            id=p.id, conflict_id=p.conflict_id, summary=p.summary,
            actions=[ResolutionActionModel(kind=a.kind, train=a.train, detail=a.detail, hold_sec=a.hold_sec)
                     for a in p.actions],
            delay_saved_min=p.delay_saved_min, conflicts_resolved=p.conflicts_resolved,
            connections_protected=p.connections_protected, passengers_protected=p.passengers_protected,
            verified=p.verified, verify_note=p.verify_note, applied=p.applied,
        )

    def _build_alerts(self, conflicts, states) -> list[AlertModel]:
        out: list[AlertModel] = []
        for c in conflicts:
            kind = {"headway": "Collision risk", "platform": "Platform clash"}.get(c.type, "Congestion")
            out.append(AlertModel(id=c.id, severity=c.severity, kind=kind, message=c.message,
                                  at_sec=c.at_sec, countdown_sec=c.eta_sec, trains=c.trains))
        for s in states:
            if s.active and s.delay_min >= 10:
                out.append(AlertModel(
                    id=f"delay:{s.number}",
                    severity="critical" if s.delay_min >= 20 else "warning",
                    kind="Delay cascade",
                    message=f"{s.number} {s.name} running {s.delay_min} min late"
                            + (f" before {s.next_station}" if s.next_station else ""),
                    at_sec=0, countdown_sec=0, trains=[s.number]))
        rank = {"critical": 3, "warning": 2, "info": 1}
        out.sort(key=lambda a: (-rank[a.severity.value], a.countdown_sec))
        return out
