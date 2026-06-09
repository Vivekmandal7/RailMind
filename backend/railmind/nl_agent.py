"""NL Agent — LLM command parser with rule-based fallback."""
from __future__ import annotations

import re
import time
from typing import Optional

from . import llm, nl
from .interfaces import ModuleStatus
from .network import NetworkGraph


def parse_with_llm(raw: str, net: NetworkGraph) -> tuple[nl.Intent, str, int]:
    """Returns (intent, parser_tag, latency_ms)."""
    t0 = time.perf_counter()
    providers = llm.available_providers()
    if not providers:
        intent = nl.parse_command(raw, net)
        ms = int((time.perf_counter() - t0) * 1000)
        return intent, "rule-based", ms

    p = providers[0]
    codes = ", ".join(sorted(net.stations.keys())[:40])
    trains = ", ".join(t.number for t in net.trains[:30])
    system = (
        "Parse railway what-if commands into JSON. Fields: "
        'type (delay|breakdown|block|fog|clear|unknown), train, add_min, '
        'section (FROM-TO), frm, to, label. Use only known station codes.'
    )
    user = (
        f"Command: {raw}\nKnown stations: {codes}\nKnown trains: {trains}\n"
        'Reply ONLY JSON e.g. {"type":"delay","train":"12951","add_min":30}'
    )
    data = llm.complete_json(p, system, user, timeout=8.0, max_tokens=200)
    ms = int((time.perf_counter() - t0) * 1000)
    if data and data.get("type") in ("delay", "breakdown", "block", "fog", "clear"):
        intent = nl.Intent(
            type=data["type"],
            train=data.get("train"),
            add_min=int(data["add_min"]) if data.get("add_min") else None,
            section=data.get("section"),
            frm=data.get("frm"),
            to=data.get("to"),
            label=data.get("label"),
            raw=raw,
        )
        return intent, f"llm:{p.label}", ms

    # try second provider if first failed
    if len(providers) > 1:
        p2 = providers[1]
        data = llm.complete_json(p2, system, user, timeout=8.0, max_tokens=200)
        ms = int((time.perf_counter() - t0) * 1000)
        if data and data.get("type") in ("delay", "breakdown", "block", "fog", "clear"):
            intent = nl.Intent(
                type=data["type"],
                train=data.get("train"),
                add_min=int(data["add_min"]) if data.get("add_min") else None,
                section=data.get("section"),
                frm=data.get("frm"),
                to=data.get("to"),
                label=data.get("label"),
                raw=raw,
            )
            return intent, f"llm:{p2.label}", ms

    intent = nl.parse_command(raw, net)
    return intent, "rule-based", ms


def explain_whatif(
    intent: nl.Intent, conflicts: list, plans: list, *, parser_tag: str,
) -> tuple[str, str, int]:
    """Returns (explanation, model_tag, latency_ms)."""
    t0 = time.perf_counter()
    if intent.type == "unknown":
        return nl.echo(intent), parser_tag, 0

    crit = sum(1 for c in conflicts if c.severity == "critical")
    pax = sum(c.passengers_affected for c in conflicts)
    top = plans[0] if plans else None

    providers = llm.available_providers()
    if providers:
        p = providers[0]
        system = (
            "You are a railway operations advisor. Explain the what-if simulation outcome "
            "in 2-4 plain sentences for a control-room operator."
        )
        user = (
            f"Command parsed as: {nl.echo(intent)}\n"
            f"Conflicts: {len(conflicts)} ({crit} critical), ~{pax:,} passengers affected.\n"
            f"Top plan: {top.summary if top else 'none'}.\n"
            f"Delay saved: {top.delay_saved_min if top else 0} min."
        )
        txt = llm.complete(p, system, user, timeout=10.0, max_tokens=350, temperature=0.2)
        ms = int((time.perf_counter() - t0) * 1000)
        if txt:
            return txt.strip(), f"{p.label} ({ms}ms)", ms

    # rule-based fallback
    head = {
        "delay": f"+{intent.add_min} min on {intent.train} ripples forward.",
        "block": f"Closing {intent.label} forces traffic onto remaining capacity.",
        "breakdown": f"{intent.train} stalls and blocks its section.",
        "fog": "Fog slows every service; running times stretch.",
        "clear": "All disruptions cleared; network returning to plan.",
    }.get(intent.type, "")
    risk = (
        f"Projected {len(conflicts)} conflict(s) ({crit} critical) affecting ~{pax:,} passengers."
        if conflicts else "No new conflicts projected in the look-ahead window."
    )
    rec = (
        f"Recommended: {top.summary} Est. {top.delay_saved_min} min saved, "
        f"{top.passengers_protected:,} passengers protected."
        if top else "No intervention required."
    )
    ms = int((time.perf_counter() - t0) * 1000)
    return f"{head} {risk} {rec}", "rule-based", ms
