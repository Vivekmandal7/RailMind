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
  lastSpeedKmh: number;
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
          lastSpeedKmh: t.speedKmh,
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

      // Authoritative target at this instant (backend eased position + short age extrapolation)
      let authTarget = Math.max(0, Math.min(total, t.distKm));
      if (t.speedKmh > 0.5 && snapAgeSec > 0) {
        authTarget = Math.min(total, authTarget + (t.speedKmh * snapAgeSec) / 3600);
      }

      let r = this.rendered.get(t.number);
      if (!r) {
        r = { distKm: authTarget, bearing: t.bearing, lastSpeedKmh: t.speedKmh, initialized: true };
        this.rendered.set(t.number, r);
      }

      // Inertial walk + soft correction: integrate using last visual speed for "live" feel,
      // then pull toward the (age-corrected) backend target. This hides WS tick gaps without
      // the trains looking like they are rubber-banding or stuck.
      const dtHours = Math.max(0, dtReal) / 3600;
      const carry = (r.lastSpeedKmh || t.speedKmh) * dtHours;
      let next = r.distKm + carry;

      const catchK = Math.min(1, dtReal * 9 + 0.02); // responsive but not twitchy
      next += (authTarget - next) * catchK;

      // clamp and store
      r.distKm = Math.max(0, Math.min(total, next));

      // visual speed for this frame (for trail length + provenance)
      const visualSpeed = Math.max(0, ((r.distKm - (r.distKm - carry)) / Math.max(1e-6, dtHours)) / 3600 || t.speedKmh);
      r.lastSpeedKmh = t.speedKmh * 0.6 + visualSpeed * 0.4; // blend toward reported for stability

      const { pos, bearing } = interpAlong(g.polyline, g.cum, r.distKm);
      r.bearing = lerpAngle(r.bearing, bearing, Math.min(1, dtReal * 14));

      const snap = liveStateToSnapshot(t, m, pos, r.bearing, r.distKm);
      // forward the (blended) speed so trails and pulses react to motion
      snap.speedKmh = r.lastSpeedKmh;
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
