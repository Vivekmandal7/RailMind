"""Async ingestion worker: polls the provider and writes to the live store.

Respects upstream rate limits by polling in small staggered batches when the
provider says it is rate-limited; for the local replay source it refreshes every
train each cycle so SIM trains stay fresh. The worker owns no simulation logic —
it only moves reports from the feed into the store.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Sequence

from .interfaces import LiveStatusProvider
from .store import LiveStore

log = logging.getLogger("railmind.live")


class IngestionWorker:
    def __init__(
        self,
        provider: LiveStatusProvider,
        store: LiveStore,
        numbers: Sequence[str],
        *,
        interval_sec: float = 20.0,
        batch: int = 8,
        stagger_sec: float = 0.4,
        max_trains: int = 0,
    ):
        self.provider = provider
        self.store = store
        # Cap how many trains we poll. Crucial on a metered free tier: a 93-train
        # network would exhaust a 50-calls/month plan in minutes. The uncapped
        # trains simply stay SIM (honestly labelled), never blank.
        nums = list(numbers)
        self.numbers = nums[:max_trains] if max_trains and max_trains < len(nums) else nums
        self.interval = interval_sec
        # un-rate-limited sources (replay) poll every train each cycle, no stagger
        self.batch = len(self.numbers) if not provider.rate_limited else max(1, batch)
        self.stagger = 0.0 if not provider.rate_limited else max(0.0, stagger_sec)
        self._cursor = 0
        self._running = False

    async def run(self) -> None:
        if not self.provider.available() or not self.numbers:
            log.info(
                "live ingestion idle (provider=%s available=%s trains=%d)",
                self.provider.name, self.provider.available(), len(self.numbers),
            )
            return
        self._running = True
        log.info(
            "live ingestion started · provider=%s origin=%s trains=%d batch=%d every %.0fs",
            self.provider.name, self.provider.origin, len(self.numbers),
            self.batch, self.interval,
        )
        try:
            while self._running:
                await self._poll_batch()
                await asyncio.sleep(self.interval)
        except asyncio.CancelledError:  # graceful shutdown
            raise
        finally:
            await self.provider.aclose()

    async def _poll_batch(self) -> None:
        n = len(self.numbers)
        batch = [self.numbers[(self._cursor + i) % n] for i in range(min(self.batch, n))]
        self._cursor = (self._cursor + len(batch)) % n
        got = 0
        for number in batch:
            try:
                report = await self.provider.fetch(number)
            except Exception as exc:  # one bad train never kills the loop
                log.debug("live fetch failed for %s: %s", number, exc)
                report = None
            if report is not None:
                self.store.put(report)
                got += 1
            if self.stagger:
                await asyncio.sleep(self.stagger)
        log.debug("live batch: %d/%d reports (%s)", got, len(batch), self.provider.name)

    def stop(self) -> None:
        self._running = False
