import { haversineKm } from "./geo";
import type { Station, TrainState } from "./types";

export interface BoardTrain {
  number: string;
  name: string;
  status: TrainState["status"];
  delayMinutes: number;
  source?: TrainState["source"];
}

export interface ApproachTrain extends BoardTrain {
  distKm: number;
  etaNextSec: number | null;
  speedKmh: number;
}

export interface StationBoard {
  /** index = platform number - 1; null = clear. */
  platforms: (BoardTrain | null)[];
  approaching: ApproachTrain[];
  held: ApproachTrain[];
  dwellCount: number;
}

/**
 * Derive a live platform board for one station from the train states:
 *   - DWELLING: at the platform (within ~0.8 km, near-stopped) → assigned a platform
 *   - APPROACHING: heading here (next stop is this station), inbound
 *   - HELD OUTSIDE: stopped on the approach, waiting for a clear platform/block
 * This is the real operating picture, computed from interpolated positions.
 */
export function computeStationBoard(
  station: Station,
  states: TrainState[]
): StationBoard {
  const here: [number, number] = [station.lng, station.lat];
  const dwelling: BoardTrain[] = [];
  const approaching: ApproachTrain[] = [];
  const held: ApproachTrain[] = [];

  for (const t of states) {
    if (!t.active) continue;
    const d = haversineKm(t.position, here);
    const base: BoardTrain = {
      number: t.number,
      name: t.name,
      status: t.status,
      delayMinutes: t.delayMinutes,
      source: t.source
    };

    if (d < 1.1 && t.speedKmh < 14) {
      dwelling.push(base);
    } else if (t.nextStation === station.code && t.speedKmh >= 1 && d < 16) {
      approaching.push({ ...base, distKm: d, etaNextSec: t.etaNextSec, speedKmh: t.speedKmh });
    } else if (
      d < 3.5 &&
      t.speedKmh < 3 &&
      (t.status === "held" || t.status === "conflict" || t.delayMinutes > 0)
    ) {
      held.push({ ...base, distKm: d, etaNextSec: t.etaNextSec, speedKmh: t.speedKmh });
    }
  }

  approaching.sort((a, b) => a.distKm - b.distKm);
  held.sort((a, b) => a.distKm - b.distKm);

  const n = Math.max(1, station.platforms);
  const platforms: (BoardTrain | null)[] = Array.from(
    { length: n },
    (_, i) => dwelling[i] ?? null
  );

  return {
    platforms,
    approaching: approaching.slice(0, 6),
    held: held.slice(0, 6),
    dwellCount: dwelling.length
  };
}
