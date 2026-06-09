"""Orchestrator: wires the loop.

    tick -> detect -> forecast -> predict -> optimize -> verify -> explain -> apply -> broadcast

It owns the mutable simulation state (clock, disruptions, applied plans) and the
injected module implementations. Heavy analysis (detect/predict/optimize) is
throttled to keep the broadcast light while train states stream every tick.
"""
from __future__ import annotations

import time
import uuid
from dataclasses import replace

from . import nl, nl_agent
from .anomaly import BaselineAnomalySentinel
from .brain import BrainTracker
from .explainer import LLMExplainer
from .forecaster import GBMDelayForecaster
from .interfaces import (
    AnomalySentinel,
    Conflict,
    ConflictDetector,
    DelayForecaster,
    Disruption,
    Explainer,
    Optimizer,
    PassengerImpactEstimator,
    Predictor,
    ResolutionPlan,
    SimContext,
    Verifier,
)
from .models import (
    AlertModel,
    ConflictModel,
    LiveStatusModel,
    ModuleStatusModel,
    NetworkModel,
    PredictionModel,
    RecommendationModel,
    ResolutionActionModel,
    SectionModel,
    StationModel,
    TimelineEventModel,
    TrainStateModel,
    TrainStaticModel,
    TwinSnapshot,
)
from .network import NetworkGraph
from .passenger import HeuristicPassengerImpact
from .timeline import TimelineLog
from .twin import DigitalTwin
from .verifier_llm import MultiModelVerifier


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
        forecaster: DelayForecaster | None = None,
        explainer: Explainer | None = None,
        passenger: PassengerImpactEstimator | None = None,
        anomaly: AnomalySentinel | None = None,
        brain: BrainTracker | None = None,
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
        self.forecaster = forecaster or GBMDelayForecaster()
        self.explainer = explainer or LLMExplainer()
        self.passenger = passenger or HeuristicPassengerImpact()
        self.anomaly = anomaly or BaselineAnomalySentinel()
        self.brain = brain or BrainTracker()

        self.time_scale = time_scale
        self.loop = loop
        self.autonomous = autonomous
        self.detect_interval = detect_interval_sec

        self.window_start, self.window_end = self._compute_window()
        self.sim_sec = start_clock_sec if start_clock_sec is not None else self.window_start
        # Loop back to the (busy) start clock rather than the empty window edge,
        # so the corridor never sits with zero active trains for long.
        self._loop_reset = self.sim_sec
        self.playing = True

        self.delays_sec: dict[str, float] = {}
        self.frozen: dict[str, float] = {}
        self.blocked: set[str] = set()
        self.speed_factor: float = 1.0
        self.disruptions: list[Disruption] = []

        self.applied_ids: set[str] = set()
        self.applied_plans: list[ResolutionPlan] = []

        self._last_detect_sim = -1e9
        # Cache key for the optimize/verify/explain (LLM) block — re-run only when
        # the world actually changes, so we don't hammer Claude/GPT every cycle.
        self._world_sig: tuple | None = None
        self._conflicts: list[Conflict] = []
        self._plans: list[ResolutionPlan] = []
        self._predictions = []
        self._anomalies = []
        self.timeline = TimelineLog()
        self._prev_conflict_ids: set[str] = set()

        # Live data spine (attached by config after construction). When absent,
        # the engine runs exactly as before: pure schedule-driven SIM.
        self.live_store = None            # live.LiveStore | None
        self.reconciler = None            # live.Reconciler | None
        self.live_provider = None         # live.LiveStatusProvider | None
        self.ingestion_worker = None      # live.IngestionWorker | None
        self.live_delays_sec: dict[str, float] = {}

    def _compute_window(self) -> tuple[float, float]:
        start = min(t.schedule[0].dep for t in self.net.trains) - 120
        end = max(t.schedule[-1].arr for t in self.net.trains) + 300
        return start, end

    def ctx(self) -> SimContext:
        # Live-reported delay is the baseline reality; manual/plan delays layer on
        # top (a what-if hold applies *in addition* to however late a train is).
        if self.live_delays_sec:
            merged = dict(self.live_delays_sec)
            for t, v in self.delays_sec.items():
                merged[t] = merged.get(t, 0.0) + v
        else:
            merged = self.delays_sec
        return SimContext(
            sim_sec=self.sim_sec,
            delays_sec=merged,
            frozen=self.frozen,
            blocked=self.blocked,
            speed_factor=self.speed_factor,
        )

    def _refresh_live(self) -> None:
        """Pull the latest reconciled delays from the live store (cheap)."""
        if self.reconciler is not None:
            self.live_delays_sec = self.reconciler.live_delays()

    def advance(self, real_dt: float) -> None:
        """Fast path: move the clock + fold in live delays. No heavy analysis.

        The transport calls this every tick so train positions stream smoothly,
        while the brain (detect/optimize/verify, incl. blocking LLM calls) runs
        on a separate cadence off the event loop — see run_pipeline()."""
        if self.playing:
            self.sim_sec += real_dt * self.time_scale
            if self.sim_sec >= self.window_end:
                self.sim_sec = self._loop_reset if self.loop else self.window_end
        self._refresh_live()

    def run_pipeline(self) -> None:
        """Heavy path: conflict detect → forecast → optimize → verify → explain."""
        self._run_pipeline()

    def step(self, real_dt: float) -> None:
        """Synchronous advance + pipeline in one call (used by tests/REST)."""
        self.advance(real_dt)
        self._run_pipeline()

    def _run_pipeline(self) -> None:
        if self.sim_sec - self._last_detect_sim < self.detect_interval * self.time_scale \
                and self.sim_sec >= self._last_detect_sim:
            return
        self._last_detect_sim = self.sim_sec
        ctx = self.ctx()
        states = self.twin.compute_states(ctx)

        # Conflict detection
        t0 = time.perf_counter()
        self.brain.set("conflict_detector", status="running", last_action="Scanning 45-min look-ahead")
        self._conflicts = self.detector.detect(self.twin, ctx)
        det_ms = int((time.perf_counter() - t0) * 1000)
        self.brain.finish(
            "conflict_detector", status="ok" if self._conflicts else "idle",
            last_action=f"{len(self._conflicts)} conflict(s) in look-ahead",
            latency_ms=det_ms,
            detail=f"{len(self._conflicts)} active",
        )
        cur_ids = {c.id for c in self._conflicts}
        for c in self._conflicts:
            if c.id not in self._prev_conflict_ids:
                self.timeline.push(
                    "conflict", f"Conflict detected · {c.type}",
                    c.message,
                    severity=c.severity, sim_sec=self.sim_sec, ref_id=c.id,
                    dedupe_key=f"conflict:{c.id}",
                )
        self._prev_conflict_ids = cur_ids

        # ML delay forecast (feeds predictor)
        t0 = time.perf_counter()
        self.brain.set("delay_ml", status="running", last_action="Forecasting delays")
        forecasts = self.forecaster.forecast(self.twin, states, ctx)
        fc_kind = getattr(self.forecaster, "kind", "heuristic")
        fc_ms = int((time.perf_counter() - t0) * 1000)
        self.brain.finish(
            "delay_ml",
            status="ok" if forecasts else "idle",
            last_action=f"{'ML' if fc_kind == 'ml' else 'Heuristic'} · {len(forecasts)} trains",
            latency_ms=fc_ms,
            detail=getattr(self.forecaster, "model_source", fc_kind) or fc_kind,
        )
        if forecasts:
            top = max(forecasts, key=lambda f: f.predicted_delay_min)
            self.timeline.push(
                "forecast", "Delay ML forecast",
                f"{len(forecasts)} trains · peak +{top.predicted_delay_min}m on {top.train}",
                severity="info", sim_sec=self.sim_sec,
                dedupe_key=f"fc:{len(forecasts)}:{top.train}:{int(self.sim_sec)}",
            )

        # Cascade + ML hybrid predictions
        t0 = time.perf_counter()
        self.brain.set("cascade", status="running", last_action="Predicting cascades")
        self._predictions = self.predictor.predict(self.twin, states, ctx)
        pred_ms = int((time.perf_counter() - t0) * 1000)
        self.brain.finish(
            "cascade", status="ok" if self._predictions else "idle",
            last_action=f"{len(self._predictions)} delay projection(s)",
            latency_ms=pred_ms,
            detail=f"merged with {len(forecasts)} ML forecasts",
        )
        if self._predictions:
            self.timeline.push(
                "forecast", "Cascade predictor",
                f"{len(self._predictions)} downstream delay projection(s)",
                severity="warning" if any(p.predicted_delay_min >= 10 for p in self._predictions) else "info",
                sim_sec=self.sim_sec,
                dedupe_key=f"cascade:{len(self._predictions)}:{int(self.sim_sec)}",
            )

        # Passenger impact + anomaly scan (baseline modules)
        t0 = time.perf_counter()
        pax = self.passenger.estimate(self.twin, states, ctx)
        pax_ms = int((time.perf_counter() - t0) * 1000)
        affected = sum(p.passengers_affected for p in pax if p.passengers_affected > 0)
        self.brain.finish(
            "passenger", status="ok",
            last_action=f"{affected:,} pax at risk",
            latency_ms=pax_ms,
            detail=f"{len(pax)} trains assessed",
        )

        t0 = time.perf_counter()
        self._anomalies = self.anomaly.scan(self.twin, states, ctx)
        an_ms = int((time.perf_counter() - t0) * 1000)
        self.brain.finish(
            "anomaly", status="flag" if self._anomalies else "idle",
            last_action=f"{len(self._anomalies)} anomaly signal(s)",
            latency_ms=an_ms,
            detail=self._anomalies[0].message[:80] if self._anomalies else "Nominal",
        )

        # Optimize + verify + explain — the LLM-heavy block (CP-SAT + Claude/GPT
        # verifier + explainer). Re-run ONLY when the world changes; otherwise
        # reuse cached plans, so we neither starve the loop nor burn API tokens
        # every cycle on an unchanged conflict.
        world_sig = (
            tuple(sorted(c.id for c in self._conflicts)),
            tuple(sorted(self.applied_ids)),
            tuple(sorted(self.blocked)),
            tuple(sorted(self.frozen.keys())),
            round(self.speed_factor, 3),
            len(self.disruptions),
        )
        if self._conflicts and world_sig == self._world_sig and self._plans:
            for _p in self._plans:
                _p.applied = _p.conflict_id in self.applied_ids
            self._maybe_autoapply()
            return

        plans: list[ResolutionPlan] = []
        for c in self._conflicts:
            t0 = time.perf_counter()
            self.brain.set("optimizer", status="running",
                            last_action=f"CP-SAT on {len(c.trains)} trains @ {c.location_label}")
            plan = self.optimizer.propose(self.twin, c, states)
            opt_ms = int((time.perf_counter() - t0) * 1000)
            self.brain.finish(
                "optimizer", status="ok",
                last_action=f"{plan.delay_saved_min}m saved · {len(plan.actions)} action(s)",
                latency_ms=opt_ms,
                detail=c.location_label,
            )

            t0 = time.perf_counter()
            self.brain.set("verifier", status="running", last_action="Multi-model safety check")
            if isinstance(self.verifier, MultiModelVerifier):
                vresult = self.verifier.verify_full(self.twin, plan, c)
                plan.verified = vresult.verified
                plan.verify_note = vresult.note
                plan.verifier_agree = vresult.agree
                plan.verifier_total = vresult.total
                plan.flagged_for_human = vresult.flagged
            else:
                ok, note = self.verifier.verify(self.twin, plan, c)
                plan.verified = ok
                plan.verify_note = note
                plan.verifier_agree = 1 if ok else 0
                plan.verifier_total = 1
            ver_ms = int((time.perf_counter() - t0) * 1000)
            self.brain.finish(
                "verifier",
                status="flag" if plan.flagged_for_human else ("ok" if plan.verified else "error"),
                last_action=(
                    f"{'✓' if plan.verified else '✗'} {plan.verifier_agree}/{plan.verifier_total} agree"
                ),
                latency_ms=ver_ms,
                detail=plan.verify_note[:100],
            )

            expl = self.explainer.explain(plan, c)
            plan.explanation = expl.text

            acts = "; ".join(f"{a.kind} {a.train}" for a in plan.actions[:3])
            self.timeline.push(
                "optimize", "OR-Tools plan generated",
                f"{plan.delay_saved_min}m saved · {acts}",
                severity="info", sim_sec=self.sim_sec, ref_id=plan.id,
                dedupe_key=f"plan:{plan.id}",
            )
            self.timeline.push(
                "verify",
                "Verified ✓" if plan.verified else "Flagged for review",
                f"{plan.verifier_agree}/{plan.verifier_total} models · {plan.verify_note[:120]}",
                severity="safe" if plan.verified else ("warning" if plan.flagged_for_human else "critical"),
                sim_sec=self.sim_sec, ref_id=plan.conflict_id,
                dedupe_key=f"verify:{plan.conflict_id}:{plan.verified}",
            )

            plan.applied = c.id in self.applied_ids
            plans.append(plan)

        if not self._conflicts:
            self.brain.set("optimizer", status="idle", last_action="No conflicts to optimize",
                            latency_ms=0, detail="Monitoring")
            self.brain.set("verifier", status="idle", last_action="Standing by",
                            latency_ms=0, detail="")

        self._plans = plans
        self._world_sig = world_sig
        self._maybe_autoapply()

    def _maybe_autoapply(self) -> None:
        if not self.autonomous:
            return
        for c in self._conflicts:
            if c.severity == "critical" and c.id not in self.applied_ids:
                plan = next((p for p in self._plans if p.conflict_id == c.id and p.verified), None)
                if plan:
                    self._apply(plan)
                    break

    def snapshot(self) -> TwinSnapshot:
        ctx = self.ctx()
        states = self.twin.compute_states(ctx)
        alerts = self._build_alerts(self._conflicts, states)
        trains = [self._train_model(s) for s in states]
        return TwinSnapshot(
            sim_sec=self.sim_sec,
            tick_hz=0,
            time_scale=self.time_scale,
            autonomous=self.autonomous,
            trains=trains,
            conflicts=[self._conflict_model(c) for c in self._conflicts],
            recommendations=[self._rec_model(p) for p in self._plans],
            predictions=[
                PredictionModel(train=p.train, predicted_delay_min=p.predicted_delay_min, cause=p.cause)
                for p in self._predictions
            ],
            alerts=alerts,
            disruptions=[d.label for d in self.disruptions],
            engine_modules=[self._module_model(m) for m in self.brain.snapshot()],
            timeline=[self._timeline_model(e) for e in self.timeline.snapshot()],
            live=self._live_model(trains),
        )

    def _live_model(self, trains) -> LiveStatusModel | None:
        if self.live_provider is None:
            return None
        counts = {"live": 0, "interpolated": 0, "predicted": 0, "sim": 0}
        for t in trains:
            counts[t.source] = counts.get(t.source, 0) + 1
        age = self.live_store.newest_live_age_sec() if self.live_store else None
        return LiveStatusModel(
            provider=self.live_provider.name,
            origin=self.live_provider.origin,
            available=bool(self.live_provider.available()),
            updated_sec_ago=round(age, 1) if age is not None else None,
            live_count=counts.get("live", 0) + counts.get("interpolated", 0),
            source_counts=counts,
        )

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
        self.timeline.push(
            "apply", "Plan applied",
            plan.summary[:140],
            severity="safe", sim_sec=self.sim_sec, ref_id=plan.conflict_id,
        )
        self._last_detect_sim = -1e9

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
        self.disruptions.append(Disruption(
            id=str(uuid.uuid4()), kind="breakdown", label=f"Breakdown: {train}",
            train=train, frozen_dist_km=st.dist_km, at_sec=self.sim_sec,
        ))
        self.timeline.push("inject", "Breakdown injected", f"Train {train} stalled",
                           severity="critical", sim_sec=self.sim_sec)
        self._last_detect_sim = -1e9

    def inject_block(self, section_id: str | None = None) -> None:
        ctx = self.ctx()
        states = self.twin.compute_states(ctx)
        sec_id = section_id or "KSRA-IGP"
        if not self._section_has_traffic(states, sec_id):
            alt = self._pick_occupied_section(states, prefer_ghat=True)
            if alt:
                sec_id = alt
        self.blocked.add(sec_id)
        sec = self.net.section(sec_id)
        label = f"{sec.frm}\u2013{sec.to}" if sec else sec_id
        self.disruptions.append(Disruption(
            id=str(uuid.uuid4()), kind="block", label=f"Block: {label}",
            section=sec_id, at_sec=self.sim_sec,
        ))
        self.timeline.push("inject", "Section blocked", label,
                           severity="critical", sim_sec=self.sim_sec, ref_id=sec_id)
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
        self.disruptions.append(Disruption(
            id=str(uuid.uuid4()), kind="block", label=f"Block: {label}", at_sec=self.sim_sec,
        ))
        self._last_detect_sim = -1e9

    def inject_fog(self) -> None:
        self.speed_factor = 0.6
        self.disruptions.append(Disruption(
            id=str(uuid.uuid4()), kind="fog", label="Fog: speed restriction",
            speed_factor=0.6, at_sec=self.sim_sec,
        ))
        self.timeline.push("inject", "Fog restriction", "Network speed 60%",
                           severity="warning", sim_sec=self.sim_sec)
        self._last_detect_sim = -1e9

    def inject_delay(self, train: str, add_min: int) -> None:
        self.delays_sec[train] = self.delays_sec.get(train, 0.0) + add_min * 60
        self.disruptions.append(Disruption(
            id=str(uuid.uuid4()), kind="delay", label=f"+{add_min}m {train}",
            train=train, add_min=add_min, at_sec=self.sim_sec,
        ))
        self._last_detect_sim = -1e9

    def clear_disruptions(self) -> None:
        self.delays_sec.clear()
        self.frozen.clear()
        self.blocked.clear()
        self.speed_factor = 1.0
        self.disruptions.clear()
        self.applied_ids.clear()
        self.applied_plans.clear()
        self.timeline.clear()
        self._prev_conflict_ids.clear()
        self.timeline.push("clear", "Disruptions cleared", "Network returning to plan",
                           severity="safe", sim_sec=self.sim_sec)
        self._last_detect_sim = -1e9

    def run_whatif(self, command: str) -> tuple[str, str, str]:
        t0 = time.perf_counter()
        self.brain.set("nl_agent", status="running", last_action=f"Parsing: {command[:40]}")
        intent, parser_tag, parse_ms = nl_agent.parse_with_llm(command, self.net)
        echo = nl.echo(intent)

        if intent.type == "delay" and intent.train and intent.add_min:
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

        explanation, expl_model, expl_ms = nl_agent.explain_whatif(
            intent, self._conflicts, self._plans, parser_tag=parser_tag,
        )
        total_ms = int((time.perf_counter() - t0) * 1000)
        self.brain.finish(
            "nl_agent", status="ok" if intent.type != "unknown" else "flag",
            last_action=f"{parser_tag} · {intent.type}",
            latency_ms=total_ms,
            detail=f"parse {parse_ms}ms · explain {expl_ms}ms ({expl_model})",
        )
        return intent.type, echo, explanation

    def network_model(self) -> NetworkModel:
        return NetworkModel(
            corridor_id=getattr(self, "corridor_id", "corridor"),
            corridor_name=getattr(self, "corridor_name", "Corridor"),
            stations=[
                StationModel(code=s.code, name=s.name, lat=s.lat, lng=s.lng, platforms=s.platforms)
                for s in self.net.stations.values()
            ],
            sections=[
                SectionModel(
                    id=s.id, frm=s.frm, to=s.to, line=s.line, capacity=s.capacity,
                    ghat=s.ghat, geometry=s.geometry, length_km=s.length_km, cum_km=s.cum_km,
                )
                for s in self.net.section_list
            ],
            trains=[
                TrainStaticModel(
                    number=t.number, name=t.name, type=t.type, direction=t.direction,
                    coaches=t.coaches, capacity_pax=t.capacity_pax, route=t.route,
                    polyline=t.polyline, cum_km=t.poly_cum_km, total_km=t.total_km,
                )
                for t in self.net.trains
            ],
        )

    @staticmethod
    def _canon_section(sec_id: str) -> str:
        a, b = sec_id.split("-", 1)
        return f"{a}-{b}" if a < b else f"{b}-{a}"

    def _section_has_traffic(self, states, section_id: str) -> bool:
        key = self._canon_section(section_id)
        return any(
            s.active and s.current_section and self._canon_section(s.current_section) == key
            for s in states
        )

    def _pick_occupied_section(self, states, *, prefer_ghat: bool = True) -> str | None:
        load: dict[str, int] = {}
        for s in states:
            if not s.active or not s.current_section:
                continue
            key = self._canon_section(s.current_section)
            load[key] = load.get(key, 0) + int(s.est_passengers)

        for prefer in ("KSRA-IGP", "IGP-KSRA"):
            if load.get(self._canon_section(prefer), 0) > 0:
                return prefer

        if prefer_ghat:
            for sec in self.net.section_list:
                if (sec.ghat or sec.line == "single") and load.get(self._canon_section(sec.id), 0) > 0:
                    return sec.id

        if not load:
            ghat = next((s for s in self.net.section_list if s.ghat), None)
            return ghat.id if ghat else (self.net.section_list[0].id if self.net.section_list else None)

        return max(load.items(), key=lambda kv: kv[1])[0]

    def _train_model(self, s) -> TrainStateModel:
        source, confidence, age = s.source, s.confidence, s.last_report_age_sec
        if self.reconciler is not None:
            prov = self.reconciler.provenance(s.number)
            source, confidence, age = prov.source, prov.confidence, prov.last_report_age_sec
        return TrainStateModel(
            number=s.number, status=s.status, active=s.active, dist_km=s.dist_km,
            position=s.position, heading_deg=s.heading_deg, speed_kmh=s.speed_kmh,
            delay_min=s.delay_min, next_station=s.next_station, prev_station=s.prev_station,
            current_section=s.current_section, eta_next_sec=s.eta_next_sec,
            eta_final_sec=s.eta_final_sec, est_passengers=s.est_passengers,
            source=source, confidence=confidence, last_report_age_sec=age,
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
            actions=[
                ResolutionActionModel(kind=a.kind, train=a.train, detail=a.detail, hold_sec=a.hold_sec)
                for a in p.actions
            ],
            delay_saved_min=p.delay_saved_min, conflicts_resolved=p.conflicts_resolved,
            connections_protected=p.connections_protected, passengers_protected=p.passengers_protected,
            verified=p.verified, verify_note=p.verify_note, applied=p.applied,
            explanation=p.explanation, verifier_agree=p.verifier_agree,
            verifier_total=p.verifier_total, flagged_for_human=p.flagged_for_human,
        )

    @staticmethod
    def _timeline_model(e) -> TimelineEventModel:
        return TimelineEventModel(
            id=e.id, kind=e.kind, title=e.title, detail=e.detail,
            severity=e.severity, sim_sec=e.sim_sec, ref_id=e.ref_id, wall_ms=e.wall_ms,
        )

    @staticmethod
    def _module_model(m) -> ModuleStatusModel:
        return ModuleStatusModel(
            key=m.key, name=m.name, status=m.status,
            last_action=m.last_action, latency_ms=m.latency_ms, detail=m.detail,
        )

    def _build_alerts(self, conflicts, states) -> list[AlertModel]:
        out: list[AlertModel] = []
        for c in conflicts:
            kind = {"headway": "Collision risk", "platform": "Platform clash"}.get(c.type, "Congestion")
            out.append(AlertModel(
                id=c.id, severity=c.severity, kind=kind, message=c.message,
                at_sec=c.at_sec, countdown_sec=c.eta_sec, trains=c.trains,
            ))
        for s in states:
            if s.active and s.delay_min >= 10:
                out.append(AlertModel(
                    id=f"delay:{s.number}",
                    severity="critical" if s.delay_min >= 20 else "warning",
                    kind="Delay cascade",
                    message=f"{s.number} {s.name} running {s.delay_min} min late"
                            + (f" before {s.next_station}" if s.next_station else ""),
                    at_sec=0, countdown_sec=0, trains=[s.number],
                ))
        for a in self._anomalies:
            sev = a.severity if a.severity in ("critical", "warning", "info") else "info"
            out.append(AlertModel(
                id=a.id, severity=sev, kind="Anomaly",
                message=a.message, at_sec=0, countdown_sec=0, trains=[],
            ))
        rank = {"critical": 3, "warning": 2, "info": 1}
        out.sort(key=lambda a: (-rank[a.severity.value], a.countdown_sec))
        return out
