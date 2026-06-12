import { create } from "zustand";
import { loadIndiaNetwork, networkFromDTO, simWindow } from "@/lib/dataLoader";
import {
  computeAllStates,
  detectConflicts,
  EngineParams
} from "@/lib/simulationEngine";
import { proposeResolution } from "@/lib/optimizer";
import { parseCommand, intentEcho, NLIntent } from "@/lib/nlCommand";
import { LiveClient } from "@/lib/liveClient";
import type { TwinSnapshotDTO, NetworkDTO, LiveStatusDTO } from "@/lib/contract";
import type { OrmStyle } from "@/lib/ormOverlay";
import type {
  AlertItem,
  Conflict,
  Disruption,
  EngineModule,
  LngLat,
  NetworkData,
  ResolutionPlan,
  TimelineEvent,
  TrainState
} from "@/lib/types";
import { localTimeline } from "@/lib/timelineLocal";
import { pickBlockSection, labelSection } from "@/lib/disruptionTarget";

const net: NetworkData = loadIndiaNetwork();
const win = simWindow(net);

// Corridor this tab loaded its network for; used to detect a backend corridor
// switch (from another tab) and resync via reload.
let loadedCorridorId = "";

function applyLocalIndiaNet(): Partial<State> {
  const indiaNet = loadIndiaNetwork();
  const { geom, meta } = buildLocalGeom(indiaNet);
  const indiaWin = simWindow(indiaNet);
  return {
    net: indiaNet,
    corridorName: "India-wide Rail Network (local)",
    trainGeom: geom,
    trainMeta: meta,
    windowStart: indiaWin.start,
    windowEnd: indiaWin.end,
    simSec: Math.max(indiaWin.start, 11 * 3600)
  };
}

export interface TrainGeom {
  polyline: LngLat[];
  cum: number[];
}
interface TrainMeta {
  name: string;
  type: string;
  direction: string;
  route: string[];
}

const liveClient = new LiveClient();
const LOCAL = buildLocalGeom(net);

function buildLocalGeom(n: NetworkData): {
  geom: Record<string, TrainGeom>;
  meta: Record<string, TrainMeta>;
} {
  const geom: Record<string, TrainGeom> = {};
  const meta: Record<string, TrainMeta> = {};
  for (const t of n.trains) {
    geom[t.number] = { polyline: t.polyline, cum: t.polyCumKm };
    meta[t.number] = { name: t.name, type: t.type, direction: t.direction, route: t.route };
  }
  return { geom, meta };
}

function buildLiveGeom(dto: NetworkDTO): {
  geom: Record<string, TrainGeom>;
  meta: Record<string, TrainMeta>;
} {
  const geom: Record<string, TrainGeom> = {};
  const meta: Record<string, TrainMeta> = {};
  for (const t of dto.trains) {
    geom[t.number] = { polyline: t.polyline as LngLat[], cum: t.cum_km };
    meta[t.number] = { name: t.name, type: t.type, direction: t.direction, route: t.route };
  }
  return { geom, meta };
}

/** Map a backend TwinSnapshot (snake_case DTO) into the UI's runtime shapes. */
function mapSnapshot(
  snap: TwinSnapshotDTO,
  meta: Record<string, TrainMeta>
): {
  states: TrainState[];
  conflicts: Conflict[];
  plans: ResolutionPlan[];
  alerts: AlertItem[];
  appliedPlans: ResolutionPlan[];
} {
  const states: TrainState[] = snap.trains.map((t) => {
    const m = meta[t.number];
    return {
      number: t.number,
      name: m?.name ?? t.number,
      type: (m?.type as TrainState["type"]) ?? "express",
      direction: (m?.direction as TrainState["direction"]) ?? "UP",
      status: t.status as TrainState["status"],
      position: t.position,
      bearing: t.heading_deg,
      speedKmh: t.speed_kmh,
      distKm: t.dist_km,
      delayMinutes: t.delay_min,
      active: t.active,
      nextStation: t.next_station,
      prevStation: t.prev_station,
      currentSection: t.current_section,
      etaNextSec: t.eta_next_sec,
      etaFinalSec: t.eta_final_sec,
      estPassengers: t.est_passengers,
      source: t.source ?? "sim",
      confidence: t.confidence,
      lastReportAgeSec: t.last_report_age_sec
    };
  });

  const conflicts: Conflict[] = snap.conflicts.map((c) => ({
    id: c.id,
    type: c.type as Conflict["type"],
    severity: c.severity,
    atSec: c.at_sec,
    etaSec: c.eta_sec,
    location: c.location,
    locationLabel: c.location_label,
    trains: c.trains,
    message: c.message,
    passengersAffected: c.passengers_affected,
    connectionsAtRisk: c.connections_at_risk
  }));

  const plans: ResolutionPlan[] = snap.recommendations.map((p) => ({
    id: p.id,
    conflictId: p.conflict_id,
    summary: p.summary,
    actions: p.actions.map((a) => ({
      kind: a.kind as any,
      train: a.train,
      detail: a.detail,
      holdSec: a.hold_sec ?? undefined
    })),
    delaySavedMin: p.delay_saved_min,
    conflictsResolved: p.conflicts_resolved,
    connectionsProtected: p.connections_protected,
    passengersProtected: p.passengers_protected,
    verified: p.verified,
    verifyNote: p.verify_note,
    explanation: p.explanation,
    verifierAgree: p.verifier_agree,
    verifierTotal: p.verifier_total,
    flaggedForHuman: p.flagged_for_human
  }));

  const alerts: AlertItem[] = snap.alerts.map((a) => ({
    id: a.id,
    severity: a.severity,
    kind: a.kind,
    message: a.message,
    atSec: a.at_sec,
    countdownSec: a.countdown_sec,
    trains: a.trains
  }));

  const appliedPlans = plans.filter((_, i) => snap.recommendations[i].applied);

  return { states, conflicts, plans, alerts, appliedPlans };
}

export interface CascadeResult {
  source: string;
  trains: string[];
  stations: string[];
  sections: string[];
}

interface NLLog {
  id: number;
  cmd: string;
  echo: string;
  explanation: string;
}

interface State {
  net: NetworkData;
  windowStart: number;
  windowEnd: number;

  simSec: number;
  playing: boolean;
  speed: number; // sim-acceleration

  // disruptions
  delaysSec: Record<string, number>;
  frozen: Record<string, number>;
  blocked: Set<string>;
  speedFactor: number;
  disruptions: Disruption[];

  autonomous: boolean;
  appliedPlans: ResolutionPlan[];
  resolvedConflictIds: Set<string>;

  // derived
  states: TrainState[];
  conflicts: Conflict[];
  plans: ResolutionPlan[];
  alerts: AlertItem[];
  predictions: { train: string; predictedDelayMin: number; cause: string }[];
  engineModules: EngineModule[];
  timeline: TimelineEvent[];

  // demo / onboarding
  demoActive: boolean;
  demoCaption: string | null;
  demoEngineOverride: EngineModule[] | null;

  // live transport
  mode: "live" | "local";
  connected: boolean;
  corridorName: string;
  tickHz: number;
  trainGeom: Record<string, TrainGeom>;
  trainMeta: Record<string, TrainMeta>;
  lastSnapshotAt: number; // performance.now() of the last live frame
  /** Data-spine health: which feed drives the twin + how fresh it is. */
  live: LiveStatusDTO | null;

  // ui
  selectedTrain: string | null;
  trackTrain: string | null;
  cascade: CascadeResult | null;
  passengerLayer: boolean;
  /** OpenRailwayMap infrastructure overlay (off | standard | maxspeed | signals | electrification). */
  ormStyle: OrmStyle;
  ormOpacity: number;
  nlLog: NLLog[];
  injectNotice: string | null;

  fitRoute: string[] | null;

  // actions
  initLive: () => Promise<void>;
  ingestSnapshot: (snap: TwinSnapshotDTO) => void;
  tick: (deltaRealSec: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  scrub: (sec: number) => void;
  resetSim: () => void;

  injectBreakdown: (train?: string) => void;
  injectBlock: (sectionId?: string) => void;
  injectFog: () => void;
  clearDisruptions: () => void;

  applyPlan: (plan: ResolutionPlan) => void;
  setAutonomous: (on: boolean) => void;

  selectTrain: (n: string | null) => void;
  setTrack: (n: string | null) => void;
  showCascade: (n: string) => void;
  clearCascade: () => void;
  togglePassengerLayer: () => void;
  setOrmStyle: (s: OrmStyle) => void;
  setOrmOpacity: (o: number) => void;

  setFitRoute: (codes: string[] | null) => void;

  mapResetSeq: number;
  requestMapReset: () => void;

  focusConflictId: string | null;
  focusConflict: (id: string | null) => void;
  syncLocalSim: (simSec: number) => void;

  // overlay KPI feed for India map local sim (Phase 5)
  overlayStates: TrainState[];
  overlaySimSec: number;
  setOverlayKpi: (states: TrainState[], simSec: number) => void;

  runNL: (cmd: string) => void;
  cleanupLive: () => void;

  jumpToTimelineEvent: (ev: TimelineEvent) => void;
  setDemoState: (patch: {
    demoActive?: boolean;
    demoCaption?: string | null;
    demoEngineOverride?: EngineModule[] | null;
  }) => void;
  focusCorridor: () => void;
  focusBlockCorridor: () => void;
}

function params(s: State): EngineParams {
  return {
    simSec: s.simSec,
    delaysSec: s.delaysSec,
    frozen: s.frozen,
    blocked: s.blocked,
    speedFactor: s.speedFactor
  };
}

function mapTimeline(dto: TwinSnapshotDTO["timeline"]): TimelineEvent[] {
  return (dto ?? []).map((e) => ({
    id: e.id,
    kind: e.kind,
    title: e.title,
    detail: e.detail,
    severity: e.severity,
    simSec: e.sim_sec,
    refId: e.ref_id ?? undefined,
    wallMs: e.wall_ms
  }));
}

function syncLocalTimeline(s: State): TimelineEvent[] {
  return localTimeline.sync({
    simSec: s.simSec,
    conflicts: s.conflicts,
    plans: s.plans,
    disruptions: s.disruptions,
    resolvedConflictIds: s.resolvedConflictIds
  });
}

function withLocalTimeline(s: State, patch: Partial<State>): Partial<State> {
  const merged = { ...s, ...patch } as State;
  if (merged.mode === "live") return patch;
  return { ...patch, timeline: syncLocalTimeline(merged) };
}

function recompute(s: State): Partial<State> {
  const p = params(s);
  const states = computeAllStates(s.net, p);
  const conflicts = detectConflicts(s.net, p);
  const plans = conflicts.map((c) => proposeResolution(s.net, c, states));
  const alerts = buildAlerts(conflicts, states);
  return { states, conflicts, plans, alerts };
}

function buildAlerts(conflicts: Conflict[], states: TrainState[]): AlertItem[] {
  const out: AlertItem[] = conflicts.map((c) => ({
    id: c.id,
    severity: c.severity,
    kind:
      c.type === "headway"
        ? "Collision risk"
        : c.type === "platform"
        ? "Platform clash"
        : "Congestion",
    message: c.message,
    atSec: c.atSec,
    countdownSec: c.etaSec,
    trains: c.trains
  }));
  for (const t of states) {
    if (t.active && t.delayMinutes >= 10) {
      out.push({
        id: `delay:${t.number}`,
        severity: t.delayMinutes >= 20 ? "critical" : "warning",
        kind: "Delay cascade",
        message: `${t.number} ${t.name} running ${t.delayMinutes} min late${
          t.nextStation ? ` before ${t.nextStation}` : ""
        }`,
        atSec: 0,
        countdownSec: 0,
        trains: [t.number]
      });
    }
  }
  return out.sort((a, b) => sev(b.severity) - sev(a.severity) || a.countdownSec - b.countdownSec);
}

function sev(s: string): number {
  return s === "critical" ? 3 : s === "warning" ? 2 : 1;
}

/** Downstream chain reaction for a delayed train (cascade view). */
function computeCascade(s: State, trainNumber: string): CascadeResult {
  const src = s.states.find((t) => t.number === trainNumber);
  const train = s.net.trains.find((t) => t.number === trainNumber);
  if (!src || !train) return { source: trainNumber, trains: [], stations: [], sections: [] };

  // sections the source will still traverse
  const idx = train.route.indexOf(src.nextStation ?? train.route[0]);
  const futureSections = new Set<string>();
  const futureStations = new Set<string>();
  for (let i = Math.max(0, idx - 1); i < train.route.length - 1; i++) {
    futureSections.add(canonical(`${train.route[i]}-${train.route[i + 1]}`));
    futureStations.add(train.route[i + 1]);
  }

  const affected = new Set<string>();
  for (const other of s.states) {
    if (other.number === trainNumber || !other.active) continue;
    const ot = s.net.trains.find((t) => t.number === other.number)!;
    // does another train share any upcoming section soon after the source?
    let shares = false;
    for (let i = 0; i < ot.route.length - 1; i++) {
      const sec = canonical(`${ot.route[i]}-${ot.route[i + 1]}`);
      if (futureSections.has(sec)) {
        shares = true;
        break;
      }
    }
    const close = Math.abs((other.etaNextSec ?? 0) - (src.etaNextSec ?? 0)) < 35 * 60;
    if (shares && close && src.delayMinutes > 0) affected.add(other.number);
  }

  return {
    source: trainNumber,
    trains: Array.from(affected),
    stations: Array.from(futureStations),
    sections: Array.from(futureSections)
  };
}

function canonical(secId: string): string {
  const [a, b] = secId.split("-");
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export const useStore = create<State>((set, get) => ({
  net,
  windowStart: win.start,
  windowEnd: win.end,

  simSec: Math.max(win.start, 11 * 3600), // 11:00 IST — national network busy
  playing: true,
  speed: 60,

  delaysSec: {},
  frozen: {},
  blocked: new Set<string>(),
  speedFactor: 1,
  disruptions: [],

  injectNotice: null as string | null,

  autonomous: false,
  appliedPlans: [],
  resolvedConflictIds: new Set<string>(),

  states: [],
  conflicts: [],
  plans: [],
  alerts: [],
  predictions: [],
  engineModules: [],
  timeline: [],

  demoActive: false,
  demoCaption: null,
  demoEngineOverride: null,

  mode: "local",
  connected: false,
  corridorName: "India-wide Rail Network",
  tickHz: 60,
  live: null,
  trainGeom: LOCAL.geom,
  trainMeta: LOCAL.meta,
  lastSnapshotAt: 0,

  selectedTrain: null,
  trackTrain: null,
  cascade: null,
  passengerLayer: false,
  ormStyle: "off",
  ormOpacity: 0.85,
  nlLog: [],
  fitRoute: null,

  mapResetSeq: 0,

  focusConflictId: null,

  overlayStates: [],
  overlaySimSec: 11 * 3600,

  initLive: async () => {
    const ok = await liveClient.health();
    if (!ok) {
      const indiaPatch = applyLocalIndiaNet();
      set({
        mode: "local",
        connected: false,
        ...indiaPatch,
        ...withLocalTimeline(
          { ...get(), ...indiaPatch } as State,
          recompute({ ...get(), ...indiaPatch } as State)
        )
      });
      return;
    }
    try {
      const dto = await liveClient.fetchNetwork();
      loadedCorridorId = dto.corridor_id;
      const liveNet = networkFromDTO(dto);
      const { geom, meta } = buildLiveGeom(dto);
      const win = simWindow(liveNet);
      set({
        mode: "live",
        connected: false,
        net: liveNet,
        corridorName: dto.corridor_name,
        trainGeom: geom,
        trainMeta: meta,
        windowStart: win.start,
        windowEnd: win.end,
        selectedTrain: null,
        trackTrain: null,
        cascade: null,
        fitRoute: null
      });
      liveClient.onStatus = (c) => set({ connected: c });
      liveClient.onSnapshot = (snap) => get().ingestSnapshot(snap);
      liveClient.connect();
    } catch {
      const indiaPatch = applyLocalIndiaNet();
      set({
        mode: "local",
        connected: false,
        ...indiaPatch,
        ...withLocalTimeline(
          { ...get(), ...indiaPatch } as State,
          recompute({ ...get(), ...indiaPatch } as State)
        )
      });
    }
  },

  ingestSnapshot: (snap) => {
    // Corridor switched on the backend (e.g. another tab) → this tab is stale.
    // Reload once so its network/meta resync instead of streaming mismatched data.
    if (
      typeof window !== "undefined" &&
      snap.corridor_id &&
      loadedCorridorId &&
      snap.corridor_id !== loadedCorridorId
    ) {
      window.location.reload();
      return;
    }
    const s = get();
    const mapped = mapSnapshot(snap, s.trainMeta);
    set({
      simSec: snap.sim_sec,
      tickHz: snap.tick_hz || 5,
      autonomous: snap.autonomous,
      states: mapped.states,
      conflicts: mapped.conflicts,
      plans: mapped.plans,
      alerts: mapped.alerts,
      appliedPlans: mapped.appliedPlans,
      disruptions: snap.disruptions.map((label, i) => ({
        id: `d${i}`,
        kind: "delay" as const,
        label,
        atSec: 0
      })),
      predictions: snap.predictions.map((p) => ({
        train: p.train,
        predictedDelayMin: p.predicted_delay_min,
        cause: p.cause
      })),
      engineModules: (snap.engine_modules ?? []).map((m) => ({
        key: m.key,
        name: m.name,
        status: m.status,
        lastAction: m.last_action,
        latencyMs: m.latency_ms,
        detail: m.detail
      })),
      timeline: mapTimeline(snap.timeline),
      live: snap.live ?? null,
      lastSnapshotAt:
        typeof performance !== "undefined" ? performance.now() : Date.now()
    });
  },

  tick: (deltaRealSec) => {
    const s = get();
    if (s.mode === "live") return; // WebSocket drives state in live mode
    if (!s.playing) return;
    let next = s.simSec + deltaRealSec * s.speed;
    if (next >= s.windowEnd) next = s.windowStart; // loop the hour
    const base = { ...s, simSec: next };
    const derived = recompute(base);

    // autonomous mode auto-applies the most urgent unresolved critical plan
    const patch: Partial<State> = { simSec: next, ...derived };
    if (s.autonomous && derived.plans && derived.conflicts) {
      const urgent = derived.conflicts.find(
        (c) => c.severity === "critical" && !s.resolvedConflictIds.has(c.id)
      );
      if (urgent) {
        const plan = derived.plans.find((p) => p.conflictId === urgent.id);
        if (plan) {
          applyPlanInternal(set, get, plan, true);
          return;
        }
      }
    }
    set(withLocalTimeline(s, patch));
  },

  setPlaying: (p) => {
    if (get().mode === "live") liveClient.send({ action: "control", playing: p });
    set({ playing: p });
  },
  setSpeed: (sp) => {
    if (get().mode === "live") liveClient.send({ action: "control", time_scale: sp });
    set({ speed: sp });
  },
  scrub: (sec) => {
    const s = get();
    const clamped = Math.max(s.windowStart, Math.min(s.windowEnd, sec));
    if (s.mode === "live") {
      liveClient.send({ action: "control", playing: false, seek_sec: clamped });
      set({ simSec: clamped, playing: false });
      return;
    }
    set(withLocalTimeline(s, { simSec: clamped, playing: false, ...recompute({ ...s, simSec: clamped }) }));
  },
  resetSim: () => {
    const s = get();
    localTimeline.clear(s.windowStart);
    const base = {
      ...s,
      simSec: s.windowStart,
      delaysSec: {},
      frozen: {},
      blocked: new Set<string>(),
      speedFactor: 1,
      disruptions: [],
      appliedPlans: [],
      resolvedConflictIds: new Set<string>(),
      cascade: null
    };
    set(withLocalTimeline(s, { ...base, ...recompute(base) }));
  },

  injectBreakdown: (train) => {
    if (get().mode === "live") {
      liveClient.send({ action: "inject", kind: "breakdown", train });
      return;
    }
    const s = get();
    const candidates = s.states.filter((t) => t.active && t.speedKmh > 0);
    const pick =
      train ?? candidates.sort((a, b) => b.estPassengers - a.estPassengers)[0]?.number;
    if (!pick) return;
    const st = s.states.find((t) => t.number === pick);
    if (!st) return;
    const frozen = { ...s.frozen, [pick]: st.distKm };
    const disruptions = [
      ...s.disruptions,
      {
        id: `brk-${pick}-${Date.now()}`,
        kind: "breakdown" as const,
        label: `Breakdown: ${pick}`,
        train: pick,
        atSec: s.simSec
      }
    ];
    localTimeline.push("inject", "Breakdown injected", `Train ${pick} stalled`, {
      severity: "critical",
      simSec: s.simSec
    });
    const base = { ...s, frozen, disruptions };
    set(withLocalTimeline(s, { frozen, disruptions, ...recompute(base) }));
  },

  injectBlock: (sectionId) => {
    const s = get();
    const pick = pickBlockSection(s.net, s.states, sectionId);
    if (!pick) return;
    const sec = pick.sectionId;

    if (s.mode === "live") {
      liveClient.send({ action: "inject", kind: "block", section: sec });
      set({ injectNotice: pick.notice ?? null });
      return;
    }

    const blocked = new Set(s.blocked);
    blocked.add(sec);
    const label = labelSection(s.net, sec);
    const disruptions = [
      ...s.disruptions,
      {
        id: `blk-${sec}-${Date.now()}`,
        kind: "block" as const,
        label: `Block: ${label}`,
        section: sec,
        atSec: s.simSec
      }
    ];
    localTimeline.push("inject", "Section blocked", label, {
      severity: "critical",
      simSec: s.simSec,
      refId: sec
    });
    const base = { ...s, blocked, disruptions };
    set(
      withLocalTimeline(s, {
        blocked,
        disruptions,
        injectNotice: pick.notice ?? null,
        ...recompute(base)
      })
    );
  },

  injectFog: () => {
    if (get().mode === "live") {
      liveClient.send({ action: "inject", kind: "fog" });
      return;
    }
    const s = get();
    const speedFactor = 0.6;
    const disruptions = [
      ...s.disruptions,
      {
        id: `fog-${Date.now()}`,
        kind: "fog" as const,
        label: "Fog: speed restriction",
        speedFactor,
        atSec: s.simSec
      }
    ];
    localTimeline.push("inject", "Fog restriction", "Network speed 60%", {
      severity: "warning",
      simSec: s.simSec
    });
    const base = { ...s, speedFactor, disruptions };
    set(withLocalTimeline(s, { speedFactor, disruptions, ...recompute(base) }));
  },

  clearDisruptions: () => {
    if (get().mode === "live") {
      liveClient.send({ action: "inject", kind: "clear" });
      set({ cascade: null, injectNotice: null });
      return;
    }
    const s = get();
    const timeline = localTimeline.clear(s.simSec);
    const base = {
      ...s,
      delaysSec: {},
      frozen: {},
      blocked: new Set<string>(),
      speedFactor: 1,
      disruptions: [],
      cascade: null,
      resolvedConflictIds: new Set<string>(),
      appliedPlans: []
    };
    set(
      withLocalTimeline(s, {
        delaysSec: {},
        frozen: {},
        blocked: new Set<string>(),
        speedFactor: 1,
        disruptions: [],
        cascade: null,
        resolvedConflictIds: new Set<string>(),
        appliedPlans: [],
        timeline,
        injectNotice: null,
        ...recompute(base)
      })
    );
  },

  applyPlan: (plan) => {
    if (get().mode === "live") {
      liveClient.send({ action: "apply", conflict_id: plan.conflictId });
      return;
    }
    applyPlanInternal(set, get, plan, false);
  },

  setAutonomous: (on) => {
    if (get().mode === "live") liveClient.send({ action: "autonomous", enabled: on });
    set({ autonomous: on });
  },

  selectTrain: (n) => set({ selectedTrain: n }),
  setTrack: (n) => set({ trackTrain: n, selectedTrain: n }),
  showCascade: (n) => {
    const s = get();
    set({ cascade: computeCascade(s, n), selectedTrain: n });
  },
  clearCascade: () => set({ cascade: null }),
  togglePassengerLayer: () => set({ passengerLayer: !get().passengerLayer }),
  setOrmStyle: (s) => set({ ormStyle: s }),
  setOrmOpacity: (o) => set({ ormOpacity: Math.min(1, Math.max(0.3, o)) }),
  setFitRoute: (codes) => set({ fitRoute: codes }),

  requestMapReset: () => set({ mapResetSeq: get().mapResetSeq + 1 }),

  focusConflict: (id) => {
    const s = get();
    if (!id) {
      set({ focusConflictId: null });
      return;
    }
    const c = s.conflicts.find((x) => x.id === id);
    if (!c) return;
    set({ focusConflictId: id });
    get().scrub(Math.max(s.windowStart, c.atSec - 90));
    if (c.trains[0]) get().setTrack(c.trains[0]);
  },

  syncLocalSim: (simSec) => {
    const s = get();
    if (s.mode === "live") return;
    const clamped = Math.max(s.windowStart, Math.min(s.windowEnd, simSec));
    set(
      withLocalTimeline(s, {
        simSec: clamped,
        ...recompute({ ...s, simSec: clamped })
      })
    );
  },

  runNL: (cmd) => {
    const s = get();
    const currentNet = s.net;
    if (s.mode === "live") {
      const echo = intentEcho(parseCommand(cmd, currentNet), currentNet);
      const pending: NLLog = { id: Date.now(), cmd, echo, explanation: "Simulating\u2026" };
      set({ nlLog: [pending, ...s.nlLog].slice(0, 8) });
      liveClient.whatif(cmd).then((res) => {
        if (!res) return;
        set((st) => ({
          nlLog: st.nlLog.map((l) =>
            l.id === pending.id ? { ...l, explanation: res.explanation } : l
          )
        }));
      });
      return;
    }
    const intent = parseCommand(cmd, currentNet);
    const echo = intentEcho(intent, currentNet);
    applyIntent(set, get, intent);
    const after = get();
    const explanation = explainImpact(intent, s, after);
    const log: NLLog = { id: Date.now(), cmd, echo, explanation };
    set({ nlLog: [log, ...after.nlLog].slice(0, 8) });
  },

  cleanupLive: () => liveClient.disconnect(),

  setOverlayKpi: (states, simSec) => set({ overlayStates: states, overlaySimSec: simSec }),

  jumpToTimelineEvent: (ev) => {
    const s = get();
    const refId = ev.refId;
    get().scrub(ev.simSec);
    const attach = () => {
      const st = get();
      if (refId) {
        const conflict = st.conflicts.find((c) => c.id === refId);
        if (conflict?.trains[0]) {
          get().setTrack(conflict.trains[0]);
          return;
        }
        const train = st.states.find((t) => t.number === refId);
        if (train) get().setTrack(refId);
      }
    };
    if (s.mode === "live") setTimeout(attach, 400);
    else attach();
  },

  setDemoState: (patch) => set(patch),

  focusCorridor: () => {
    const s = get();
    const flagship =
      s.net.trains.find((t) => t.number === "12951") ??
      s.net.trains.find((t) => t.route.includes("CSMT") && t.route.includes("NDLS")) ??
      s.net.trains.find((t) => t.type === "express");
    const route =
      flagship?.route ??
      s.net.trains[0]?.route ??
      s.net.stations.slice(0, 2).map((st) => st.code);
    if (route?.length) set({ fitRoute: route, trackTrain: null, selectedTrain: null });
  },

  focusBlockCorridor: () => {
    const s = get();
    const pick = pickBlockSection(s.net, s.states);
    if (!pick) {
      get().focusCorridor();
      return;
    }
    const sec = s.net.sectionMap[pick.sectionId];
    const route = sec ? [sec.from, sec.to] : pick.sectionId.split("-");
    set({ fitRoute: route, trackTrain: null, selectedTrain: null });
  }
}));

export { liveClient };

function applyPlanInternal(
  set: (p: Partial<State>) => void,
  get: () => State,
  plan: ResolutionPlan,
  autonomous: boolean
) {
  const s = get();
  if (plan.flaggedForHuman) {
    if (s.mode !== "live") {
      localTimeline.push("blocked", "Apply blocked", "Plan flagged for human review", {
        severity: "warning",
        simSec: s.simSec,
        refId: plan.conflictId
      });
      set(withLocalTimeline(s, { timeline: localTimeline.snapshot() }));
    }
    return;
  }
  const delaysSec = { ...s.delaysSec };
  for (const a of plan.actions) {
    if (a.holdSec && a.kind !== "speed") {
      delaysSec[a.train] = (delaysSec[a.train] ?? 0) + a.holdSec;
    }
  }
  const resolvedConflictIds = new Set(s.resolvedConflictIds);
  resolvedConflictIds.add(plan.conflictId);
  const appliedPlans = [{ ...plan }, ...s.appliedPlans].slice(0, 12);
  if (s.mode !== "live") {
    localTimeline.push("apply", "Plan applied", plan.summary.slice(0, 140), {
      severity: "safe",
      simSec: s.simSec,
      refId: plan.conflictId
    });
  }
  const base = { ...s, delaysSec, resolvedConflictIds, appliedPlans };
  set(withLocalTimeline(s, { delaysSec, resolvedConflictIds, appliedPlans, ...recompute(base) }));
}

function applyIntent(
  set: (p: Partial<State>) => void,
  get: () => State,
  intent: NLIntent
) {
  const s = get();
  switch (intent.type) {
    case "delay": {
      const delaysSec = { ...s.delaysSec };
      delaysSec[intent.train] = (delaysSec[intent.train] ?? 0) + intent.addMin * 60;
      const disruptions = [
        ...s.disruptions,
        {
          id: `dly-${intent.train}-${Date.now()}`,
          kind: "delay" as const,
          label: `+${intent.addMin}m ${intent.train}`,
          train: intent.train,
          addMin: intent.addMin,
          atSec: s.simSec
        }
      ];
      const base = { ...s, delaysSec, disruptions };
      set({ delaysSec, disruptions, ...recompute(base) });
      break;
    }
    case "breakdown":
      get().injectBreakdown(intent.train);
      break;
    case "block":
      get().injectBlock(intent.section);
      break;
    case "fog":
      get().injectFog();
      break;
    case "clear":
      get().clearDisruptions();
      break;
    default:
      break;
  }
}

// seed derived state for the first render before the loop starts ticking
useStore.setState((s) => withLocalTimeline(s as State, recompute(s as State)));

function explainImpact(intent: NLIntent, before: State, after: State): string {
  if (intent.type === "unknown") return intentEcho(intent, after.net);
  const newCrit = after.conflicts.filter((c) => c.severity === "critical").length;
  const pax = after.conflicts.reduce((s, c) => s + c.passengersAffected, 0);
  const topPlan = after.plans[0];
  const head =
    intent.type === "delay"
      ? `+${intent.addMin} min on ${intent.train} ripples forward.`
      : intent.type === "block"
      ? `Closing ${intent.label} forces all traffic onto remaining capacity.`
      : intent.type === "breakdown"
      ? `${intent.train} stalls and blocks its section.`
      : `Fog slows every service; running times stretch.`;
  const risk = after.conflicts.length
    ? `Projected ${after.conflicts.length} conflict(s) (${newCrit} critical) affecting ~${pax.toLocaleString()} passengers.`
    : `No new conflicts projected in the look-ahead window.`;
  const rec = topPlan
    ? `Recommended response: ${topPlan.summary} Est. ${topPlan.delaySavedMin} min saved, ${topPlan.passengersProtected.toLocaleString()} passengers protected.`
    : `No intervention required.`;
  return `${head} ${risk} ${rec}`;
}
