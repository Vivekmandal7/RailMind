import type { LngLat } from "./indiaRailNetwork";
import { interpAlong } from "./geo";

export interface ScheduleStop {
  station: string;
  dist: number;
  arr: number;
  dep: number;
}

/** Quintic smootherstep — zero velocity at segment ends (accel / decel). */
export function smootherstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/**
 * Map effective schedule time → distance along route with eased legs and dwells.
 * Each inter-station leg uses smootherstep so trains ease away from / into stops.
 */
export function distanceAtEffectiveTime(stops: ScheduleStop[], te: number): number {
  if (stops.length === 0) return 0;
  if (te <= stops[0].dep) return stops[0].dist;

  const last = stops[stops.length - 1];
  if (te >= last.arr) return last.dist;

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];

    if (te >= a.arr && te <= a.dep) return a.dist;

    if (te > a.dep && te < b.arr) {
      const legT = b.arr - a.dep;
      if (legT <= 0) return a.dist;
      const u = (te - a.dep) / legT;
      const legDist = b.dist - a.dist;
      return a.dist + legDist * smootherstep(u);
    }
  }

  return last.dist;
}

/** Sample a glowing trail polyline along the track behind the current position. */
export function buildTrackTrail(
  polyline: LngLat[],
  polyCumKm: number[],
  endDistKm: number,
  trailKm: number,
  samples = 32
): LngLat[] {
  if (polyline.length < 2) return [];
  const total = polyCumKm[polyCumKm.length - 1] ?? 0;
  const end = Math.max(0, Math.min(total, endDistKm));
  const start = Math.max(0, end - trailKm);
  if (end - start < 0.02) return [interpAlong(polyline, polyCumKm, end).pos];

  const path: LngLat[] = [];
  for (let i = 0; i <= samples; i++) {
    const d = start + ((end - start) * i) / samples;
    path.push(interpAlong(polyline, polyCumKm, d).pos);
  }
  return path;
}

/** Trail length (km) scales gently with speed so fast trains leave longer comets. */
export function trailLengthKm(speedKmh: number): number {
  return Math.min(22, Math.max(4, 5 + speedKmh * 0.12));
}

/** Approximate speed from finite difference of eased distance function. */
export function speedAtEffectiveTime(
  stops: ScheduleStop[],
  te: number,
  windowSec = 30
): number {
  const d0 = distanceAtEffectiveTime(stops, te);
  const d1 = distanceAtEffectiveTime(stops, te + windowSec);
  return Math.max(0, ((d1 - d0) / windowSec) * 3600);
}

export function nextPrevStations(
  route: string[],
  routeCumKm: number[],
  distKm: number
): { prevStation: string | null; nextStation: string | null } {
  let prevStation: string | null = null;
  let nextStation: string | null = null;
  for (let i = 0; i < route.length; i++) {
    if (routeCumKm[i] <= distKm + 0.05) prevStation = route[i];
    if (routeCumKm[i] > distKm + 0.05) {
      nextStation = route[i];
      break;
    }
  }
  return { prevStation, nextStation };
}

export function etaAtDistance(stops: ScheduleStop[], d: number): number | null {
  if (stops.length === 0) return null;
  if (d <= stops[0].dist) return stops[0].dep;
  const last = stops[stops.length - 1];
  if (d >= last.dist) return null;

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (d >= a.dist && d <= b.dist) {
      const legDist = b.dist - a.dist;
      if (legDist <= 0) return b.arr;
      const frac = (d - a.dist) / legDist;
      const inv = invertSmootherstep(frac);
      return a.dep + (b.arr - a.dep) * inv;
    }
  }
  return null;
}

/** Inverse of smootherstep via binary search (monotonic). */
function invertSmootherstep(y: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (smootherstep(mid) < y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
