"""Provider registry — pick a live-status source by config name.

Add a new upstream API as one class implementing ``LiveStatusProvider`` and
register it here. Nothing else in the engine changes.
"""
from __future__ import annotations

from typing import Callable

from ..interfaces import LiveStatusProvider
from .rapidapi import RapidApiProvider
from .replay import ReplayProvider

# Each builder takes (net, clock_fn) so a provider may use the schedule and clock.
PROVIDERS: dict[str, Callable[..., LiveStatusProvider]] = {
    "replay": lambda net, clock_fn: ReplayProvider(net, clock_fn),
    "rapidapi": lambda net, clock_fn: RapidApiProvider(net),
}


def build_provider(kind: str, net, clock_fn) -> LiveStatusProvider:
    builder = PROVIDERS.get(kind)
    if builder is None:
        builder = PROVIDERS["replay"]
    return builder(net, clock_fn)


__all__ = ["PROVIDERS", "build_provider", "RapidApiProvider", "ReplayProvider"]
