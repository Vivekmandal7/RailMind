import { interpAlong } from "./geo";
import type { LngLat } from "./indiaRailNetwork";
import type { TrainSnapshot, TrainStatus } from "./indiaTrains";
import type { TrainState } from "./types";

export interface TrainGeom {
  polyline: LngLat[];
  cum: number[];
}

export interface TrainMeta {
  name: string;
  route: string[];
}

interface RenderedTrain {
  distKm: number;
  bearing: number;
  initialized: boolean;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + 540) % 360) - 180;
  return a + d * t;
}

function mapStatus(status: string): TrainStatus {
  switch (status) {
    case "conflict":
      return "conflict";
    case "delayed":
      return "delayed";
    case "held":
      return "held";
    case "scheduled":
      return "scheduled";
    case "arrived":
      return "arrived";
    default:
      return "running";
  }
}

export function liveStateToSnapshot(
  state: TrainState,
  meta: TrainMeta | undefined,
  pos: LngLat,
  bearing: number,
  distKm: number
): TrainSnapshot {
  return {
    number: state.number,
    name: meta?.name ?? state.name,
    routeStations: meta?.route ?? [],
    polyline: [],
    polyCumKm: [],
    position: pos,
    bearing,
    distKm,
    speedKmh: state.speedKmh,
    status: mapStatus(state.status),
    delayMinutes: state.delayMinutes,
    estPassengers: state.estPassengers,
    nextStation: state.nextStation,
    prevStation: state.prevStation,
    etaNextSec: state.etaNextSec,
    etaFinalSec: state.etaFinalSec,
    active: state.active
  };
}

/** Smooth 60fps interpolation between backend twin ticks (~5 Hz). */
export class TwinInterpolator {
  private rendered = new Map<string, RenderedTrain>();
  private targets = new Map<string, TrainState>();
  private lastSnapshotAt = 0;

  reset(): void {
    this.rendered.clear();
    this.targets.clear();
    this.lastSnapshotAt = 0;
  }

  ingest(states: TrainState[], snapshotAt: number): void {
    this.lastSnapshotAt = snapshotAt;
    const seen = new Set<string>();
    for (const t of states) {
      seen.add(t.number);
      this.targets.set(t.number, t);
      if (!t.active) {
        this.rendered.delete(t.number);
        continue;
      }
      const r = this.rendered.get(t.number);
      if (!r) {
        this.rendered.set(t.number, {
          distKm: t.distKm,
          bearing: t.bearing,
          initialized: true
        });
      }
    }
    for (const num of this.rendered.keys()) {
      if (!seen.has(num)) this.rendered.delete(num);
    }
  }

  step(
    dtReal: number,
    geom: Record<string, TrainGeom>,
    meta: Record<string, TrainMeta>,
    now = performance.now()
  ): TrainSnapshot[] {
    const snapAgeSec = this.lastSnapshotAt > 0 ? Math.min(2, (now - this.lastSnapshotAt) / 1000) : 0;
    const out: TrainSnapshot[] = [];

    for (const t of this.targets.values()) {
      const g = geom[t.number];
      const m = meta[t.number];
      if (!g || g.polyline.length < 2) {
        out.push(
          liveStateToSnapshot(t, m, t.position, t.bearing, t.distKm)
        );
        continue;
      }

      const total = g.cum[g.cum.length - 1] ?? 0;
      if (!t.active) continue;

      let targetDist = Math.max(0, Math.min(total, t.distKm));
      if (t.speedKmh > 0.5 && snapAgeSec > 0) {
        targetDist = Math.min(
          total,
          targetDist + (t.speedKmh * snapAgeSec) / 3600
        );
      }

      let r = this.rendered.get(t.number);
      if (!r) {
        r = { distKm: targetDist, bearing: t.bearing, initialized: true };
        this.rendered.set(t.number, r);
      }

      const k = Math.min(1, dtReal * 10);
      r.distKm += (targetDist - r.distKm) * k;

      const { pos, bearing } = interpAlong(g.polyline, g.cum, r.distKm);
      r.bearing = lerpAngle(r.bearing, bearing, Math.min(1, dtReal * 12));

      const snap = liveStateToSnapshot(t, m, pos, r.bearing, r.distKm);
      snap.polyline = g.polyline;
      snap.polyCumKm = g.cum;
      out.push(snap);
    }

    return out;
  }
}

export function attachRouteGeometry(
  snap: TrainSnapshot,
  geom: TrainGeom | undefined
): TrainSnapshot {
  if (!geom) return snap;
  return { ...snap, polyline: geom.polyline, polyCumKm: geom.cum };
}

/** Resolve a section id (either direction) to line geometry. */
export function sectionGeometry(
  sectionId: string,
  sectionMap: Record<string, { geometry: LngLat[] }>
): LngLat[] | null {
  const direct = sectionMap[sectionId]?.geometry;
  if (direct?.length) return direct;
  const [a, b] = sectionId.split("-");
  if (!a || !b) return null;
  const rev = sectionMap[`${b}-${a}`]?.geometry;
  if (rev?.length) return [...rev].reverse();
  const canonical = a < b ? `${a}-${b}` : `${b}-${a}`;
  const canon = sectionMap[canonical]?.geometry;
  if (canon?.length) {
    const forward = sectionMap[`${a}-${b}`]?.geometry;
    if (forward?.length) return forward;
    return [...canon].reverse();
  }
  return null;
}

export function metaFromStore(
  trainMeta: Record<string, { name: string; route: string[] }>
): Record<string, TrainMeta> {
  const out: Record<string, TrainMeta> = {};
  for (const [num, m] of Object.entries(trainMeta)) {
    out[num] = { name: m.name, route: m.route };
  }
  return out;
}

export function snapshotToTrainState(s: TrainSnapshot): import("./types").TrainState {
  return {
    number: s.number,
    name: s.name,
    type: "express",
    direction: "UP",
    status: s.status === "conflict" ? "conflict" : (s.status as import("./types").TrainState["status"]),
    position: s.position,
    bearing: s.bearing,
    speedKmh: s.speedKmh,
    distKm: s.distKm,
    delayMinutes: s.delayMinutes,
    active: s.active,
    nextStation: s.nextStation,
    prevStation: s.prevStation,
    currentSection: null,
    etaFinalSec: s.etaFinalSec,
    etaNextSec: s.etaNextSec,
    estPassengers: s.estPassengers
  };
}
