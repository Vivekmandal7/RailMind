// TypeScript mirror of backend/railmind/models.py — the shared typed contract.
// Keep these in sync with the Pydantic models (1:1).

export type LngLat = [number, number];

export interface StationDTO {
  code: string;
  name: string;
  lat: number;
  lng: number;
  platforms: number;
}

export interface SectionDTO {
  id: string;
  from: string;
  to: string;
  line: "single" | "double";
  capacity: number;
  ghat: boolean;
  geometry: LngLat[];
  length_km: number;
  cum_km: number[];
}

export interface TrainStaticDTO {
  number: string;
  name: string;
  type: "express" | "local";
  direction: "UP" | "DOWN";
  coaches: number;
  capacity_pax: number;
  route: string[];
  polyline: LngLat[];
  cum_km: number[];
  total_km: number;
}

export interface NetworkDTO {
  corridor_id: string;
  corridor_name: string;
  stations: StationDTO[];
  sections: SectionDTO[];
  trains: TrainStaticDTO[];
}

export interface TrainStateDTO {
  number: string;
  status: string;
  active: boolean;
  dist_km: number;
  position: LngLat;
  heading_deg: number;
  speed_kmh: number;
  delay_min: number;
  next_station: string | null;
  prev_station: string | null;
  current_section: string | null;
  eta_next_sec: number | null;
  eta_final_sec: number;
  est_passengers: number;
  // provenance — how this position is known (the single design principle)
  source: "live" | "interpolated" | "predicted" | "sim";
  confidence: number;
  last_report_age_sec: number | null;
}

export interface ConflictDTO {
  id: string;
  type: string;
  severity: "critical" | "warning" | "info";
  at_sec: number;
  eta_sec: number;
  location: string;
  location_label: string;
  trains: string[];
  message: string;
  passengers_affected: number;
  connections_at_risk: number;
}

export interface RecommendationDTO {
  id: string;
  conflict_id: string;
  summary: string;
  actions: { kind: string; train: string; detail: string; hold_sec: number | null }[];
  delay_saved_min: number;
  conflicts_resolved: number;
  connections_protected: number;
  passengers_protected: number;
  verified: boolean;
  verify_note: string;
  applied: boolean;
  explanation?: string;
  verifier_agree?: number;
  verifier_total?: number;
  flagged_for_human?: boolean;
}

export interface ModuleStatusDTO {
  key: string;
  name: string;
  status: string;
  last_action: string;
  latency_ms: number;
  detail: string;
}

export interface TimelineEventDTO {
  id: string;
  kind: string;
  title: string;
  detail: string;
  severity: string;
  sim_sec: number;
  ref_id: string | null;
  wall_ms: number;
}

export interface PredictionDTO {
  train: string;
  predicted_delay_min: number;
  cause: string;
}

export interface AlertDTO {
  id: string;
  severity: "critical" | "warning" | "info";
  kind: string;
  message: string;
  at_sec: number;
  countdown_sec: number;
  trains: string[];
}

export type ProvenanceSource = "live" | "interpolated" | "predicted" | "sim";

export interface LiveStatusDTO {
  provider: string;
  origin: "live" | "sim";
  available: boolean;
  updated_sec_ago: number | null;
  live_count: number;
  source_counts: Partial<Record<ProvenanceSource, number>>;
}

export interface TwinSnapshotDTO {
  corridor_id?: string;
  sim_sec: number;
  tick_hz: number;
  time_scale: number;
  autonomous: boolean;
  trains: TrainStateDTO[];
  conflicts: ConflictDTO[];
  recommendations: RecommendationDTO[];
  predictions: PredictionDTO[];
  alerts: AlertDTO[];
  disruptions: string[];
  engine_modules?: ModuleStatusDTO[];
  timeline?: TimelineEventDTO[];
  live?: LiveStatusDTO | null;
}
