import { interpAlong } from "./geo";
import {
  distanceAtEffectiveTime,
  speedAtEffectiveTime,
  etaAtDistance,
  type ScheduleStop
} from "./trainMotion";
import type {
  Conflict,
  ConflictType,
  NetworkData,
  Severity,
  Train,
  TrainState,
  TrainStatus
} from "./types";

export interface EngineParams {
  simSec: number;
  delaysSec: Record<string, number>; // train -> added delay seconds
  frozen: Record<string, number>; // train -> frozen distKm (breakdown)
  blocked: Set<string>; // blocked section ids (normalized both ways)
  speedFactor: number; // <1 means slower (fog). Adds proportional delay.
}

/** Map a train's sparse schedule stops onto cumulative route distance (for easing fns). */
function toScheduleStops(train: Train): ScheduleStop[] {
  const idxOf: Record<string, number> = {};
  train.route.forEach((c, i) => (idxOf[c] = i));
  return train.schedule.map((s) => ({
    station: s.station,
    dist: train.cumDistKm[idxOf[s.station]] ?? 0,
    arr: s.arr,
    dep: s.dep
  }));
}

/** Distance (km) travelled at an effective (delay-removed) schedule time — eased accel/decel. */
function distanceAtTime(stops: ScheduleStop[], te: number): number {
  if (!stops.length) return 0;
  return distanceAtEffectiveTime(stops, te);
}

/** Effective scheduled time at which the train reaches distance d (inverse of eased curve). */
function timeAtDistance(stops: ScheduleStop[], d: number): number {
  if (!stops.length) return 0;
  const t = etaAtDistance(stops, d);
  return t ?? stops[stops.length - 1].arr;
}

function loadFactor(train: Train): number {
  // realistic crush loads: suburban locals run well over rated capacity
  return train.type === "local" ? 1.6 : 0.82;
}

export function estPassengers(train: Train): number {
  return Math.round(train.capacityPax * loadFactor(train));
}

/** Compute a single train's live state at a given sim time. */
export function computeTrainState(
  net: NetworkData,
  train: Train,
  p: EngineParams
): TrainState {
  const stops = toScheduleStops(train);
  const delaySec = (p.delaysSec[train.number] ?? 0) + fogDelay(train, p);
  const startSec = stops[0]?.dep + delaySec || 0;
  const endSec = stops[stops.length - 1]?.arr + delaySec || 0;

  const te = p.simSec - delaySec; // effective schedule time
  let distKm: number;
  const frozenDist = p.frozen[train.number];
  const isFrozen = frozenDist !== undefined;

  if (isFrozen) {
    distKm = frozenDist;
  } else {
    distKm = distanceAtTime(stops, te);
  }

  const totalKm = train.cumDistKm[train.cumDistKm.length - 1] ?? 0;
  const active = p.simSec >= startSec && (isFrozen || distKm < totalKm - 0.001 || p.simSec < endSec);
  const arrived = !isFrozen && p.simSec >= endSec;

  const { pos, bearing } = interpAlong(train.polyline, train.polyCumKm, distKm);

  // realistic speed from derivative of the smootherstep curve
  let speedKmh = 0;
  if (!isFrozen && active && !arrived) {
    speedKmh = speedAtEffectiveTime(stops, te);
  }

  // next / prev route station relative to current distance
  let prevStation: string | null = null;
  let nextStation: string | null = null;
  for (let i = 0; i < train.route.length; i++) {
    if (train.cumDistKm[i] <= distKm + 0.05) prevStation = train.route[i];
    if (train.cumDistKm[i] > distKm + 0.05) {
      nextStation = train.route[i];
      break;
    }
  }

  // current section
  let currentSection: string | null = null;
  if (!arrived) {
    for (let i = 0; i < train.route.length - 1; i++) {
      if (distKm >= train.cumDistKm[i] - 0.001 && distKm < train.cumDistKm[i + 1] - 0.001) {
        currentSection = `${train.route[i]}-${train.route[i + 1]}`;
        break;
      }
    }
  }

  const delayMinutes = Math.round(delaySec / 60);
  let status: TrainStatus;
  if (arrived) status = "arrived";
  else if (!active) status = "scheduled";
  else if (isFrozen) status = "held";
  else if (speedKmh < 1 && delayMinutes > 0) status = "held";
  else if (delayMinutes >= 5) status = "delayed";
  else status = "running";

  const etaFinalSec = endSec;
  const etaNextSec =
    nextStation != null
      ? (() => {
          const dNext = train.cumDistKm[train.route.indexOf(nextStation)] ?? distKm;
          const et = etaAtDistance(stops, dNext);
          return et != null ? et + delaySec : null;
        })()
      : null;

  return {
    number: train.number,
    name: train.name,
    type: train.type,
    direction: train.direction,
    status,
    position: pos,
    bearing,
    speedKmh,
    distKm,
    delayMinutes,
    active: active && !arrived,
    nextStation,
    prevStation,
    currentSection,
    etaFinalSec,
    etaNextSec,
    estPassengers: estPassengers(train)
  };
}

function fogDelay(train: Train, p: EngineParams): number {
  if (p.speedFactor >= 1) return 0;
  // slower running adds time proportional to remaining distance share already covered
  const stops = toScheduleStops(train);
  const journeySec = (stops[stops.length - 1]?.arr ?? 0) - (stops[0]?.dep ?? 0);
  const extra = journeySec * (1 / p.speedFactor - 1) * 0.5;
  return extra;
}

export function computeAllStates(net: NetworkData, p: EngineParams): TrainState[] {
  return net.trains.map((t) => computeTrainState(net, t, p));
}

/** Section id occupied at a future effective distance for lookahead. */
function sectionAtDist(train: Train, distKm: number): string | null {
  for (let i = 0; i < train.route.length - 1; i++) {
    if (distKm >= train.cumDistKm[i] - 0.001 && distKm < train.cumDistKm[i + 1] - 0.001) {
      return `${train.route[i]}-${train.route[i + 1]}`;
    }
  }
  return null;
}

function canonical(secId: string): string {
  const [a, b] = secId.split("-");
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/**
 * Look-ahead conflict detection: step forward and find sections/platforms
 * whose occupancy exceeds capacity. Returns the earliest projected conflicts.
 */
export function detectConflicts(net: NetworkData, p: EngineParams): Conflict[] {
  const horizon = 45 * 60; // 45 sim-minutes ahead
  const step = 20;
  const found = new Map<string, Conflict>();

  for (let dt = 0; dt <= horizon; dt += step) {
    const at = p.simSec + dt;
    const fp: EngineParams = { ...p, simSec: at };

    // section occupancy
    const secOcc: Record<string, string[]> = {};
    const staOcc: Record<string, string[]> = {};

    for (const train of net.trains) {
      const stops = toScheduleStops(train);
      const delaySec = (p.delaysSec[train.number] ?? 0) + fogDelay(train, fp);
      const startSec = (stops[0]?.dep ?? 0) + delaySec;
      const endSec = (stops[stops.length - 1]?.arr ?? 0) + delaySec;
      if (at < startSec || at > endSec) {
        if (p.frozen[train.number] === undefined) continue;
      }
      let distKm: number;
      if (p.frozen[train.number] !== undefined) distKm = p.frozen[train.number];
      else distKm = distanceAtTime(stops, at - delaySec);

      const sec = sectionAtDist(train, distKm);
      if (sec) {
        const key = canonical(sec);
        (secOcc[key] ||= []).push(train.number);
      } else {
        // dwelling at a station
        let staIdx = -1;
        for (let i = 0; i < train.route.length; i++) {
          if (Math.abs(train.cumDistKm[i] - distKm) < 0.06) staIdx = i;
        }
        if (staIdx >= 0) (staOcc[train.route[staIdx]] ||= []).push(train.number);
      }
    }

    // section capacity breaches
    for (const [secKey, trains] of Object.entries(secOcc)) {
      const sec = net.sectionMap[secKey];
      if (!sec) continue;
      const blockedHere = isBlocked(p.blocked, secKey);
      const cap = blockedHere ? 0 : sec.capacity;
      const uniq = Array.from(new Set(trains));
      if (uniq.length > cap || (blockedHere && uniq.length > 0)) {
        const type: ConflictType = sec.line === "single" || blockedHere ? "headway" : "congestion";
        registerConflict(found, net, {
          type,
          location: secKey,
          locationLabel: `${stationName(net, sec.from)} \u2192 ${stationName(net, sec.to)}`,
          trains: uniq,
          atSec: at,
          simSec: p.simSec,
          blocked: blockedHere,
          single: sec.line === "single"
        });
      }
    }

    // platform double-booking
    for (const [sta, trains] of Object.entries(staOcc)) {
      const station = net.stationMap[sta];
      const uniq = Array.from(new Set(trains));
      if (station && uniq.length > station.platforms) {
        registerConflict(found, net, {
          type: "platform",
          location: sta,
          locationLabel: station.name,
          trains: uniq,
          atSec: at,
          simSec: p.simSec,
          blocked: false,
          single: false
        });
      }
    }
  }

  return Array.from(found.values()).sort((a, b) => a.etaSec - b.etaSec);
}

function isBlocked(blocked: Set<string>, secKey: string): boolean {
  if (blocked.has(secKey)) return true;
  const [a, b] = secKey.split("-");
  return blocked.has(`${b}-${a}`);
}

function stationName(net: NetworkData, code: string): string {
  return net.stationMap[code]?.name ?? code;
}

function registerConflict(
  found: Map<string, Conflict>,
  net: NetworkData,
  d: {
    type: ConflictType;
    location: string;
    locationLabel: string;
    trains: string[];
    atSec: number;
    simSec: number;
    blocked: boolean;
    single: boolean;
  }
) {
  // collapse the evolving subset/superset of one physical event at a location
  // into a single conflict (the earliest projected occurrence).
  const key = `${d.type}:${canonical(d.location)}`;
  if (found.has(key)) return; // keep earliest occurrence

  const trainObjs = d.trains
    .map((n) => net.trains.find((t) => t.number === n)!)
    .filter(Boolean);
  const pax = trainObjs.reduce((s, t) => s + estPassengers(t), 0);
  const connectionsAtRisk = trainObjs.filter((t) => t.type === "express").length * 2 + 1;

  let severity: Severity = "warning";
  const etaSec = d.atSec - d.simSec;
  if (d.blocked || (d.single && d.type === "headway")) severity = "critical";
  else if (d.type === "congestion") severity = "warning";
  else severity = "info";
  if (etaSec < 240 && severity !== "critical") severity = "critical";

  let message: string;
  if (d.type === "headway")
    message = d.blocked
      ? `Blocked section ${d.locationLabel}: ${d.trains.join(", ")} cannot proceed`
      : `Single-line headway breach on ${d.locationLabel} between ${d.trains.join(" & ")}`;
  else if (d.type === "platform")
    message = `Platform double-booking at ${d.locationLabel}: ${d.trains.join(", ")}`;
  else message = `Section congestion on ${d.locationLabel}: ${d.trains.join(", ")}`;

  found.set(key, {
    id: key,
    type: d.type,
    severity,
    atSec: d.atSec,
    etaSec,
    location: d.location,
    locationLabel: d.locationLabel,
    trains: d.trains,
    message,
    passengersAffected: pax,
    connectionsAtRisk
  });
}
