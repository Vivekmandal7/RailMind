"""ConflictDetector implementations.

``RuleBasedConflictDetector`` steps the twin forward over a look-ahead window
and flags capacity breaches: single-line headway (head-on), platform
double-booking, and section congestion. A future ``MLConflictDetector`` would
implement the same ``detect`` signature.
"""
from __future__ import annotations

from dataclasses import replace

from .interfaces import Conflict, ConflictDetector, DigitalTwinProto, SimContext
from .twin import est_passengers


def _canonical(section_id: str) -> str:
    a, b = section_id.split("-")
    return f"{a}-{b}" if a < b else f"{b}-{a}"


def _is_blocked(blocked: set[str], section_id: str) -> bool:
    if section_id in blocked:
        return True
    a, b = section_id.split("-")
    return f"{b}-{a}" in blocked


class RuleBasedConflictDetector(ConflictDetector):
    def __init__(self, horizon_sec: int = 45 * 60, step_sec: int = 20):
        self.horizon = horizon_sec
        self.step = step_sec

    def detect(self, twin: DigitalTwinProto, ctx: SimContext) -> list[Conflict]:
        found: dict[str, Conflict] = {}
        dt = 0
        while dt <= self.horizon:
            at = ctx.sim_sec + dt
            states = twin.compute_states(replace(ctx, sim_sec=at))
            sec_occ: dict[str, list[str]] = {}
            sta_occ: dict[str, list[str]] = {}
            for s in states:
                if not s.active and s.number not in ctx.frozen:
                    continue
                if s.current_section:
                    sec_occ.setdefault(_canonical(s.current_section), []).append(s.number)
                elif s.prev_station:
                    sta_occ.setdefault(s.prev_station, []).append(s.number)

            for sec_key, trains in sec_occ.items():
                sec = twin.section(sec_key)
                if sec is None:
                    continue
                blocked = _is_blocked(ctx.blocked, sec_key)
                cap = 0 if blocked else sec.capacity
                uniq = sorted(set(trains))
                if len(uniq) > cap:
                    ctype = "headway" if (sec.line == "single" or blocked) else "congestion"
                    self._register(found, twin, ctype, sec_key,
                                   f"{self._name(twin, sec.frm)} \u2192 {self._name(twin, sec.to)}",
                                   uniq, int(at), ctx.sim_sec, blocked, sec.line == "single")

            for sta, trains in sta_occ.items():
                station = twin.station(sta)
                uniq = sorted(set(trains))
                if station and len(uniq) > station.platforms:
                    self._register(found, twin, "platform", sta, station.name,
                                   uniq, int(at), ctx.sim_sec, False, False)
            dt += self.step

        return sorted(found.values(), key=lambda c: c.eta_sec)

    @staticmethod
    def _name(twin: DigitalTwinProto, code: str) -> str:
        st = twin.station(code)
        return st.name if st else code

    def _register(self, found, twin, ctype, location, label, trains, at_sec, sim_sec, blocked, single):
        key = f"{ctype}:{_canonical(location) if '-' in location else location}"
        if key in found:
            return
        train_objs = [twin_train for twin_train in twin.trains if twin_train.number in trains]
        pax = sum(est_passengers(t) for t in train_objs)
        connections = sum(1 for t in train_objs if t.type == "express") * 2 + 1
        eta = at_sec - sim_sec
        if blocked or (single and ctype == "headway"):
            severity = "critical"
        elif ctype == "congestion":
            severity = "warning"
        else:
            severity = "info"
        if eta < 240 and severity != "critical":
            severity = "critical"

        if ctype == "headway":
            msg = (f"Blocked section {label}: {', '.join(trains)} cannot proceed"
                   if blocked else
                   f"Single-line headway breach on {label} between {' & '.join(trains)}")
        elif ctype == "platform":
            msg = f"Platform double-booking at {label}: {', '.join(trains)}"
        else:
            msg = f"Section congestion on {label}: {', '.join(trains)}"

        found[key] = Conflict(
            id=key, type=ctype, severity=severity, at_sec=at_sec, eta_sec=int(eta),
            location=location, location_label=label, trains=trains, message=msg,
            passengers_affected=pax, connections_at_risk=connections,
        )
