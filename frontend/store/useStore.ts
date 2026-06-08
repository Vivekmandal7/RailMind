import { create } from "zustand";
import { loadNetwork, simWindow } from "@/lib/dataLoader";
import {
  computeAllStates,
  detectConflicts,
  EngineParams
} from "@/lib/simulationEngine";
import { proposeResolution } from "@/lib/optimizer";
import { parseCommand, intentEcho, NLIntent } from "@/lib/nlCommand";
import { LiveClient } from "@/lib/liveClient";
import type { TwinSnapshotDTO, NetworkDTO } from "@/lib/contract";
import type {
  AlertItem,
  Conflict,
  Disruption,
  LngLat,
  NetworkData,
  ResolutionPlan,
  TrainState
} from "@/lib/types";

const net: NetworkData = loadNetwork();
const win = simWindow(net);

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
      estPassengers: t.est_passengers
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
    verifyNote: p.verify_note
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

  // live transport
  mode: "live" | "local";
  connected: boolean;
  corridorName: string;
  tickHz: number;
  trainGeom: Record<string, TrainGeom>;
  trainMeta: Record<string, TrainMeta>;
  lastSnapshotAt: number; // performance.now() of the last live frame

  // ui
  selectedTrain: string | null;
  trackTrain: string | null;
  cascade: CascadeResult | null;
  passengerLayer: boolean;
  nlLog: NLLog[];

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

  setFitRoute: (codes: string[] | null) => void;

  runNL: (cmd: string) => void;
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

function recompute(s: State): Partial<State> {
  const p = params(s);
  const states = computeAllStates(net, p);
  const conflicts = detectConflicts(net, p);
  const plans = conflicts.map((c) => proposeResolution(net, c, states));
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
  const train = net.trains.find((t) => t.number === trainNumber);
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
    const ot = net.trains.find((t) => t.number === other.number)!;
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

  simSec: 9 * 3600 + 1200, // 09:20 — corridor busy, ghat conflicts in look-ahead
  playing: true,
  speed: 60,

  delaysSec: {},
  frozen: {},
  blocked: new Set<string>(),
  speedFactor: 1,
  disruptions: [],

  autonomous: false,
  appliedPlans: [],
  resolvedConflictIds: new Set<string>(),

  states: [],
  conflicts: [],
  plans: [],
  alerts: [],

  mode: "local",
  connected: false,
  corridorName: "Mumbai CSMT \u2013 Igatpuri",
  tickHz: 60,
  trainGeom: LOCAL.geom,
  trainMeta: LOCAL.meta,
  lastSnapshotAt: 0,

  selectedTrain: null,
  trackTrain: null,
  cascade: null,
  passengerLayer: false,
  nlLog: [],
  fitRoute: null,

  initLive: async () => {
    const ok = await liveClient.health();
    if (!ok) {
      // backend unreachable -> stay in local in-browser simulation mode
      set({ mode: "local", connected: false });
      return;
    }
    try {
      const dto = await liveClient.fetchNetwork();
      const { geom, meta } = buildLiveGeom(dto);
      set({
        mode: "live",
        corridorName: dto.corridor_name,
        trainGeom: geom,
        trainMeta: meta
      });
      liveClient.onStatus = (c) => set({ connected: c });
      liveClient.onSnapshot = (snap) => get().ingestSnapshot(snap);
      liveClient.connect();
    } catch {
      set({ mode: "local", connected: false });
    }
  },

  ingestSnapshot: (snap) => {
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
    set(patch);
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
    set({ simSec: clamped, playing: false, ...recompute({ ...s, simSec: clamped }) });
  },
  resetSim: () => {
    const s = get();
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
    set({ ...base, ...recompute(base) });
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
    const base = { ...s, frozen, disruptions };
    set({ frozen, disruptions, ...recompute(base) });
  },

  injectBlock: (sectionId) => {
    if (get().mode === "live") {
      liveClient.send({ action: "inject", kind: "block", section: sectionId ?? "NGP-BPQ" });
      return;
    }
    const s = get();
    // default: block a constrained trunk section
    const sec = sectionId ?? "NGP-BPQ";
    const blocked = new Set(s.blocked);
    blocked.add(sec);
    const secObj = net.sectionMap[sec];
    const disruptions = [
      ...s.disruptions,
      {
        id: `blk-${sec}-${Date.now()}`,
        kind: "block" as const,
        label: `Block: ${secObj ? `${secObj.from}\u2013${secObj.to}` : sec}`,
        section: sec,
        atSec: s.simSec
      }
    ];
    const base = { ...s, blocked, disruptions };
    set({ blocked, disruptions, ...recompute(base) });
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
    const base = { ...s, speedFactor, disruptions };
    set({ speedFactor, disruptions, ...recompute(base) });
  },

  clearDisruptions: () => {
    if (get().mode === "live") {
      liveClient.send({ action: "inject", kind: "clear" });
      set({ cascade: null });
      return;
    }
    const s = get();
    const base = {
      ...s,
      delaysSec: {},
      frozen: {},
      blocked: new Set<string>(),
      speedFactor: 1,
      disruptions: [],
      cascade: null
    };
    set({
      delaysSec: {},
      frozen: {},
      blocked: new Set<string>(),
      speedFactor: 1,
      disruptions: [],
      cascade: null,
      ...recompute(base)
    });
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
  setTrack: (n) => set({ trackTrain: n, selectedTrain: n ?? get().selectedTrain }),
  showCascade: (n) => {
    const s = get();
    set({ cascade: computeCascade(s, n), selectedTrain: n });
  },
  clearCascade: () => set({ cascade: null }),
  togglePassengerLayer: () => set({ passengerLayer: !get().passengerLayer }),
  setFitRoute: (codes) => set({ fitRoute: codes }),

  runNL: (cmd) => {
    const s = get();
    if (s.mode === "live") {
      // backend simulates the what-if AND returns the impact explanation
      const echo = intentEcho(parseCommand(cmd, net), net);
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
    const intent = parseCommand(cmd, net);
    const echo = intentEcho(intent, net);
    applyIntent(set, get, intent);
    const after = get();
    const explanation = explainImpact(intent, s, after);
    const log: NLLog = { id: Date.now(), cmd, echo, explanation };
    set({ nlLog: [log, ...after.nlLog].slice(0, 8) });
  }
}));

function applyPlanInternal(
  set: (p: Partial<State>) => void,
  get: () => State,
  plan: ResolutionPlan,
  autonomous: boolean
) {
  const s = get();
  const delaysSec = { ...s.delaysSec };
  for (const a of plan.actions) {
    if (a.holdSec && a.kind !== "speed") {
      delaysSec[a.train] = (delaysSec[a.train] ?? 0) + a.holdSec;
    }
  }
  const resolvedConflictIds = new Set(s.resolvedConflictIds);
  resolvedConflictIds.add(plan.conflictId);
  const appliedPlans = [{ ...plan }, ...s.appliedPlans].slice(0, 12);
  const base = { ...s, delaysSec, resolvedConflictIds, appliedPlans };
  set({ delaysSec, resolvedConflictIds, appliedPlans, ...recompute(base) });
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
useStore.setState((s) => recompute(s as State));

function explainImpact(intent: NLIntent, before: State, after: State): string {
  if (intent.type === "unknown") return intentEcho(intent, net);
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
