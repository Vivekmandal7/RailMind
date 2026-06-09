import indiaTimetable from "@/data/india_timetable.json";
import { loadIndiaRailNetwork, type LngLat } from "./indiaRailNetwork";
import { haversineKm, interpAlong, parseHHMM, polylineCum } from "./geo";
import {
  distanceAtEffectiveTime,
  etaAtDistance,
  nextPrevStations,
  speedAtEffectiveTime,
  type ScheduleStop
} from "./trainMotion";

/** Default snapshot time — 11:00 IST. */
export const STATIC_SIM_SEC = 11 * 3600;

export type TrainStatus = "running" | "delayed" | "held" | "conflict" | "scheduled" | "arrived";

export interface TrainDefinition {
  number: string;
  name: string;
  routeStations: string[];
  polyline: LngLat[];
  polyCumKm: number[];
  routeCumKm: number[];
  stops: ScheduleStop[];
  delaySec: number;
  baseStatus: TrainStatus;
  estPassengers: number;
}

export interface TrainSnapshot {
  number: string;
  name: string;
  routeStations: string[];
  polyline: LngLat[];
  polyCumKm: number[];
  position: LngLat;
  bearing: number;
  distKm: number;
  speedKmh: number;
  status: TrainStatus;
  delayMinutes: number;
  estPassengers: number;
  nextStation: string | null;
  prevStation: string | null;
  etaNextSec: number | null;
  etaFinalSec: number;
  active: boolean;
}

/** @deprecated alias kept for Phase 3 consumers */
export type PlacedTrain = TrainSnapshot;

interface SectionLookup {
  geometry: LngLat[];
  lengthKm: number;
}

let defsCached: TrainDefinition[] | null = null;

function sectionKey(a: string, b: string): string {
  return `${a}-${b}`;
}

function buildSectionLookup(): Record<string, SectionLookup> {
  const net = loadIndiaRailNetwork();
  const out: Record<string, SectionLookup> = {};

  for (const r of net.routes) {
    const { total } = polylineCum(r.geometry);
    out[sectionKey(r.from, r.to)] = { geometry: r.geometry, lengthKm: total };
    out[sectionKey(r.to, r.from)] = {
      geometry: [...r.geometry].reverse(),
      lengthKm: total
    };
  }

  return out;
}

function stitchRoutePolyline(
  route: string[],
  sections: Record<string, SectionLookup>,
  stationMap: Record<string, { lng: number; lat: number }>
): { polyline: LngLat[]; routeCumKm: number[] } {
  const polyline: LngLat[] = [];
  const routeCumKm: number[] = [];
  let runningKm = 0;

  for (let i = 0; i < route.length; i++) {
    const code = route[i];
    routeCumKm.push(runningKm);
    const st = stationMap[code];
    if (!st) continue;

    if (i === 0) {
      polyline.push([st.lng, st.lat]);
      continue;
    }

    const prev = route[i - 1];
    const sec = sections[sectionKey(prev, code)];
    if (!sec) {
      const prevPt = polyline[polyline.length - 1];
      polyline.push([st.lng, st.lat]);
      runningKm += haversineKm(prevPt, [st.lng, st.lat]);
      routeCumKm[i] = runningKm;
      continue;
    }

    let geom = sec.geometry;
    if (geom.length === 0) {
      polyline.push([st.lng, st.lat]);
      continue;
    }

    const prevSt = stationMap[prev];
    const d0 = haversineKm([prevSt.lng, prevSt.lat], geom[0]);
    const d1 = haversineKm([prevSt.lng, prevSt.lat], geom[geom.length - 1]);
    if (d1 < d0) geom = [...geom].reverse();

    for (let j = 1; j < geom.length; j++) polyline.push(geom[j]);
    runningKm += sec.lengthKm;
    routeCumKm[i] = runningKm;
  }

  return { polyline, routeCumKm };
}

function buildStops(
  route: string[],
  routeCumKm: number[],
  schedule: { station: string; arr: string; dep: string }[]
): ScheduleStop[] {
  const idxOf: Record<string, number> = {};
  route.forEach((c, i) => {
    idxOf[c] = i;
  });
  return schedule.map((s) => ({
    station: s.station,
    dist: routeCumKm[idxOf[s.station]] ?? 0,
    arr: parseHHMM(s.arr),
    dep: parseHHMM(s.dep)
  }));
}

function demoStatus(number: string): { status: TrainStatus; delayMinutes: number } {
  const n = parseInt(number, 10) || 0;
  if (n % 17 === 0) return { status: "conflict", delayMinutes: 22 };
  if (n % 7 === 0) return { status: "delayed", delayMinutes: 12 + (n % 5) };
  return { status: "running", delayMinutes: n % 11 === 0 ? 4 : 0 };
}

export function loadTrainDefinitions(): TrainDefinition[] {
  if (defsCached) return defsCached;

  const net = loadIndiaRailNetwork();
  const stationMap = Object.fromEntries(
    net.stations.map((s) => [s.code, { lng: s.lng, lat: s.lat, name: s.name }])
  );
  const sections = buildSectionLookup();
  const defs: TrainDefinition[] = [];

  for (const t of indiaTimetable.trains) {
    const { polyline, routeCumKm } = stitchRoutePolyline(t.route, sections, stationMap);
    if (polyline.length < 2) continue;

    const { cum: polyCumKm } = polylineCum(polyline);
    const { status, delayMinutes } = demoStatus(t.number);
    const loadFactor = 0.55 + (parseInt(t.number, 10) % 10) * 0.04;

    defs.push({
      number: t.number,
      name: t.name,
      routeStations: t.route,
      polyline,
      polyCumKm,
      routeCumKm,
      stops: buildStops(t.route, routeCumKm, t.schedule),
      delaySec: delayMinutes * 60,
      baseStatus: status,
      estPassengers: Math.round(t.capacityPax * loadFactor)
    });
  }

  defsCached = defs;
  return defs;
}

export function computeTrainSnapshot(def: TrainDefinition, simSec: number): TrainSnapshot {
  const { stops, delaySec, polyline, polyCumKm, routeCumKm, routeStations } = def;
  const te = simSec - delaySec;
  const firstDep = stops[0]?.dep ?? 0;
  const lastArr = stops[stops.length - 1]?.arr ?? 0;
  const etaFinalSec = lastArr + delaySec;

  let distKm = distanceAtEffectiveTime(stops, te);
  const total = polyCumKm[polyCumKm.length - 1] ?? 0;
  distKm = Math.max(0, Math.min(total, distKm));

  const { pos, bearing } = interpAlong(polyline, polyCumKm, distKm);
  const speedKmh = speedAtEffectiveTime(stops, te);
  const { prevStation, nextStation } = nextPrevStations(routeStations, routeCumKm, distKm);

  const active = simSec >= firstDep + delaySec && te < lastArr;
  const arrived = te >= lastArr;

  let status: TrainStatus;
  if (arrived) status = "arrived";
  else if (!active) status = "scheduled";
  else status = def.baseStatus;

  let etaNextSec: number | null = null;
  if (nextStation) {
    const nextIdx = routeStations.indexOf(nextStation);
    const nextDist = routeCumKm[nextIdx] ?? distKm;
    const etaTe = etaAtDistance(stops, nextDist);
    etaNextSec = etaTe != null ? etaTe + delaySec : null;
  }

  return {
    number: def.number,
    name: def.name,
    routeStations,
    polyline,
    polyCumKm,
    position: pos,
    bearing,
    distKm,
    speedKmh,
    status,
    delayMinutes: Math.round(delaySec / 60),
    estPassengers: def.estPassengers,
    nextStation,
    prevStation,
    active,
    etaNextSec,
    etaFinalSec
  };
}

export function loadPlacedTrains(simSec = STATIC_SIM_SEC): TrainSnapshot[] {
  return loadTrainDefinitions().map((d) => computeTrainSnapshot(d, simSec));
}

export function findTrainDefinition(number: string): TrainDefinition | undefined {
  return loadTrainDefinitions().find((t) => t.number === number);
}

export function findPlacedTrain(number: string, simSec = STATIC_SIM_SEC): TrainSnapshot | undefined {
  const def = findTrainDefinition(number);
  return def ? computeTrainSnapshot(def, simSec) : undefined;
}

export function searchTrains(query: string, limit = 6): TrainDefinition[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return loadTrainDefinitions()
    .filter((t) => t.number.includes(q) || t.name.toLowerCase().includes(q))
    .slice(0, limit);
}

export function statusColor(status: TrainStatus): [number, number, number, number] {
  switch (status) {
    case "conflict":
      return [255, 72, 72, 255];
    case "delayed":
      return [255, 180, 60, 255];
    case "held":
      return [255, 92, 92, 255];
    case "scheduled":
      return [120, 140, 160, 200];
    case "arrived":
      return [100, 120, 140, 180];
    default:
      return [72, 220, 120, 255];
  }
}

export function computeVisibleSnapshots(
  simSec: number,
  inView: (snap: TrainSnapshot) => boolean,
  alwaysInclude?: string | null,
  routeInView?: (def: TrainDefinition) => boolean
): TrainSnapshot[] {
  const out: TrainSnapshot[] = [];
  for (const def of loadTrainDefinitions()) {
    if (def.number !== alwaysInclude && routeInView && !routeInView(def)) continue;
    const snap = computeTrainSnapshot(def, simSec);
    if (def.number === alwaysInclude || inView(snap)) out.push(snap);
  }
  return out;
}
