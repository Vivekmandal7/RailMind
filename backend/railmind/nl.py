"""Natural-language what-if parser (rule-based, no external dependency).

Returns a structured intent. The transport layer can optionally pass the
resulting impact to an LLM for nicer phrasing, but the simulation NEVER depends
on it — this parser is always authoritative for *what* gets simulated.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from .network import NetworkGraph


@dataclass
class Intent:
    type: str  # delay | breakdown | block | fog | clear | unknown
    train: Optional[str] = None
    add_min: Optional[int] = None
    section: Optional[str] = None
    frm: Optional[str] = None
    to: Optional[str] = None
    label: Optional[str] = None
    raw: str = ""


def parse_command(raw: str, net: NetworkGraph) -> Intent:
    q = raw.strip().lower()
    if not q:
        return Intent(type="unknown", raw=raw)

    if re.search(r"\b(clear|reset)\b", q):
        return Intent(type="clear")
    if re.search(r"\bfog\b|low visibility|mist", q):
        return Intent(type="fog")

    m = re.search(r"delay\s+(\d{4,6}).*?(\d{1,3})\s*(min|m|minutes)?", q)
    if m:
        return Intent(type="delay", train=m.group(1), add_min=int(m.group(2)))

    m = re.search(r"(breakdown|breaks?\s*down|fail(?:s|ure)?|stall(?:s|ed)?)\D*(\d{4,6})", q)
    if m:
        return Intent(type="breakdown", train=m.group(2))
    m = re.search(r"(\d{4,6})\D*(breakdown|breaks?\s*down|fail|stall)", q)
    if m:
        return Intent(type="breakdown", train=m.group(1))

    codes = [c for c in re.findall(r"\b[A-Z]{2,4}\b", raw.upper()) if net.station(c)]
    if re.search(r"(close|closed|block|blocked|shut|suspend)", q) and len(codes) >= 2:
        a, b = codes[0], codes[1]
        sec = net.section(f"{a}-{b}")
        if sec:
            return Intent(type="block", section=sec.id, frm=a, to=b,
                          label=f"{net.station(sec.frm).name} \u2192 {net.station(sec.to).name}")
        # not directly adjacent -> block the whole stretch between the two stations
        if net.shortest_path(a, b):
            return Intent(type="block", section=None, frm=a, to=b,
                          label=f"{net.station(a).name} \u2192 {net.station(b).name}")

    m = re.search(r"(\d{4,6}).*?(late|delayed).*?(\d{1,3})", q)
    if m:
        return Intent(type="delay", train=m.group(1), add_min=int(m.group(3)))

    return Intent(type="unknown", raw=raw)


def echo(intent: Intent) -> str:
    if intent.type == "delay":
        return f"Injecting +{intent.add_min} min delay on {intent.train}."
    if intent.type == "breakdown":
        return f"Simulating breakdown of {intent.train} \u2014 stalls on its current section."
    if intent.type == "block":
        return f"Closing section {intent.label}. Re-routing/holding affected services."
    if intent.type == "fog":
        return "Applying fog: network-wide speed restriction in force."
    if intent.type == "clear":
        return "Cleared all injected disruptions."
    return ('Could not parse. Try: "delay 12137 by 20 min", "what if KYN-KSRA closes?", '
            '"breakdown 11061", or "fog".')
