export type LngLat = [number, number];

export interface Station {
  code: string;
  name: string;
  lat: number;
  lng: number;
  platforms: number;
}

export type LineType = "single" | "double";

export interface Section {
  id: string; // `${from}-${to}`
  from: string;
  to: string;
  line: LineType;
  capacity: number;
  ghat?: boolean;
  /** Ordered polyline (lng,lat) approximating real alignment. */
  geometry: LngLat[];
  /** Length in km. */
  lengthKm: number;
}

export interface ScheduleStop {
  station: string;
  /** seconds from midnight */
  arr: number;
  dep: number;
}

export type TrainType = "express" | "local";
export type Direction = "UP" | "DOWN";

export interface Train {
  number: string;
  name: string;
  type: TrainType;
  direction: Direction;
  coaches: number;
  capacityPax: number;
  route: string[];
  schedule: ScheduleStop[];
  /** Cumulative distance (km) along the route at each route station index. */
  cumDistKm: number[];
  /** Flattened route polyline (lng,lat) used for position interpolation. */
  polyline: LngLat[];
  /** Cumulative distance (km) at each polyline vertex. */
  polyCumKm: number[];
}

export type TrainStatus =
  | "scheduled"
  | "running"
  | "delayed"
  | "held"
  | "conflict"
  | "arrived";

export interface TrainState {
  number: string;
  name: string;
  type: TrainType;
  direction: Direction;
  status: TrainStatus;
  /** Current geo position [lng, lat]. */
  position: LngLat;
  /** Bearing in degrees. */
  bearing: number;
  /** Current speed km/h. */
  speedKmh: number;
  /** Distance travelled along route (km). */
  distKm: number;
  delayMinutes: number;
  /** Whether the train has entered service yet (after first scheduled dep). */
  active: boolean;
  nextStation: string | null;
  prevStation: string | null;
  /** Section id currently occupied, or null if dwelling at a station. */
  currentSection: string | null;
  /** ETA (seconds from midnight) at its final destination, incl. delay. */
  etaFinalSec: number;
  /** ETA at the next station (seconds from midnight). */
  etaNextSec: number | null;
  estPassengers: number;
}

export type ConflictType =
  | "headway"
  | "platform"
  | "congestion";

export type Severity = "critical" | "warning" | "info";

export interface Conflict {
  id: string;
  type: ConflictType;
  severity: Severity;
  /** seconds from midnight when the conflict is projected to occur. */
  atSec: number;
  /** seconds from now (sim) until the conflict. */
  etaSec: number;
  location: string; // section id or station code
  locationLabel: string;
  trains: string[];
  message: string;
  passengersAffected: number;
  connectionsAtRisk: number;
}

export interface ResolutionAction {
  kind: "hold" | "reorder" | "reroute" | "speed";
  train: string;
  detail: string;
  /** seconds to hold, if applicable */
  holdSec?: number;
}

export interface ResolutionPlan {
  id: string;
  conflictId: string;
  summary: string;
  actions: ResolutionAction[];
  delaySavedMin: number;
  conflictsResolved: number;
  connectionsProtected: number;
  passengersProtected: number;
  verified: boolean;
  verifyNote: string;
}

export interface AlertItem {
  id: string;
  severity: Severity;
  kind: string;
  message: string;
  atSec: number;
  countdownSec: number;
  trains: string[];
}

export interface NetworkData {
  stations: Station[];
  sections: Section[];
  trains: Train[];
  stationMap: Record<string, Station>;
  sectionMap: Record<string, Section>;
}

export interface Disruption {
  id: string;
  kind: "breakdown" | "block" | "fog" | "delay";
  label: string;
  /** affected train number (breakdown/delay) */
  train?: string;
  /** affected section id (block) */
  section?: string;
  /** speed multiplier for fog (network-wide) */
  speedFactor?: number;
  /** added delay minutes (delay) */
  addMin?: number;
  /** sim seconds when injected */
  atSec: number;
}

export interface SimSnapshot {
  simSec: number;
  trains: TrainState[];
  conflicts: Conflict[];
  alerts: AlertItem[];
}
