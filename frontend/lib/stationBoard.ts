import { haversineKm } from "./geo";
import type { Station, TrainState } from "./types";

export interface BoardTrain {
  number: string;
  name: string;
  status: TrainState["status"];
  delayMinutes: number;
  source?: TrainState["source"];
  direction: TrainState["direction"];
}

export interface ApproachTrain extends BoardTrain {
  distKm: number;
  etaNextSec: number | null;
  speedKmh: number;
}

export interface CrossingTrain extends BoardTrain {
  speedKmh: number;
}

export interface StationBoard {
  /** index = platform number - 1; null = clear. */
  platforms: (BoardTrain | null)[];
  approaching: ApproachTrain[];
  held: ApproachTrain[];
  /** trains passing THROUGH on the main line without stopping at a platform. */
  crossing: CrossingTrain[];
  dwellCount: number;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Derive a live platform board for one station from the train states.
 *   - DWELLING: at a platform — assigned by DIRECTION (UP trains take the lower
 *     platforms, DOWN the higher, like a real junction) and stable per train so
 *     a given train keeps the same platform instead of piling onto platform 1.
 *   - CROSSING: a fast train passing through on the main line (doesn't stop).
 *   - APPROACHING / HELD OUTSIDE as before.
 */
export function computeStationBoard(
  station: Station,
  states: TrainState[]
): StationBoard {
  const here: [number, number] = [station.lng, station.lat];
  const dwelling: BoardTrain[] = [];
  const approaching: ApproachTrain[] = [];
  const held: ApproachTrain[] = [];
  const crossing: CrossingTrain[] = [];

  for (const t of states) {
    if (!t.active) continue;
    const d = haversineKm(t.position, here);
    const base: BoardTrain = {
      number: t.number,
      name: t.name,
      status: t.status,
      delayMinutes: t.delayMinutes,
      source: t.source,
      direction: t.direction
    };

    if (d < 1.1 && t.speedKmh < 14) {
      dwelling.push(base);
    } else if (d < 1.5 && t.speedKmh >= 25 && t.nextStation !== station.code) {
      crossing.push({ ...base, speedKmh: t.speedKmh });
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

  // Directional, stable platform assignment.
  const n = Math.max(1, station.platforms);
  const platforms: (BoardTrain | null)[] = new Array(n).fill(null);
  const half = Math.max(1, Math.floor(n / 2));
  const ordered = [...dwelling].sort((a, b) => a.number.localeCompare(b.number));
  for (const t of ordered) {
    const up = t.direction === "UP";
    const pref = up ? hash(t.number) % half : n - 1 - (hash(t.number) % half);
    const step = up ? 1 : -1;
    let p = pref;
    let tries = 0;
    while (platforms[p] && tries < n) {
      p = (p + step + n) % n;
      tries++;
    }
    if (!platforms[p]) platforms[p] = t;
  }

  return {
    platforms,
    approaching: approaching.slice(0, 6),
    held: held.slice(0, 6),
    crossing: crossing.slice(0, 3),
    dwellCount: dwelling.length
  };
}
