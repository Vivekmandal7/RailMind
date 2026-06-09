import { IconLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer, PickingInfo } from "@deck.gl/core";
import {
  loadIndiaRailNetwork,
  pointInBounds,
  routeInBounds,
  simplifyRoute,
  type LngLat,
  type RailRoute,
  type RailStation,
  type ViewBounds
} from "./indiaRailNetwork";
import {
  statusColor,
  type TrainSnapshot,
  type TrainStatus
} from "./indiaTrains";
import { buildTrackTrail, trailLengthKm } from "./trainMotion";
import { TRAIN_ICON } from "./trainIcons";
import { sectionGeometry } from "./twinBridge";
import type { Conflict, ResolutionPlan } from "./types";

export interface MapLayerOptions {
  bounds: ViewBounds;
  zoom: number;
  selectedTrainNumber: string | null;
  hoveredTrainNumber: string | null;
  trains: TrainSnapshot[];
  selectedTrain: TrainSnapshot | null;
  dimNetwork?: boolean;
  frameTick?: number;
}

function routeColor(route: RailRoute, dim: boolean): [number, number, number, number] {
  const alpha = dim ? 90 : 185;
  if (route.ghat || route.line === "single") return [200, 160, 60, dim ? 70 : 210];
  return [90, 130, 150, alpha];
}

function routeWidth(zoom: number): number {
  if (zoom < 5) return 1;
  if (zoom < 7) return 1.25;
  return 1.5;
}

function labelTrain(
  t: TrainSnapshot,
  zoom: number,
  selected: string | null,
  hovered: string | null
): boolean {
  if (t.number === selected || t.number === hovered) return true;
  // Once zoomed into a corridor, label every active train so the operator can
  // read which blinking dot is which without clicking. Suppressed only at the
  // far-out national zoom where labels would pile up.
  if (zoom >= 6.5) return t.active;
  return false;
}

export function buildRailLayers(
  bounds: ViewBounds,
  zoom: number,
  dimNetwork: boolean
): Layer[] {
  const net = loadIndiaRailNetwork();

  const routes = net.routes
    .filter((r) => routeInBounds(r, bounds))
    .map((r) => ({
      ...r,
      path: simplifyRoute(r.geometry, zoom)
    }));

  const showAllStations = zoom >= 5.5;
  const stations: RailStation[] = net.stations.filter((s) => {
    if (!pointInBounds(s.lng, s.lat, bounds)) return false;
    if (showAllStations) return true;
    return s.major;
  });

  const showLabels = zoom >= 7.5;
  const labelStations = showLabels ? stations.filter((s) => s.major) : [];

  const glowAlpha = dimNetwork ? 12 : 28;
  const glowRoutes = routes.map((r) => ({ path: r.path }));

  const layers: Layer[] = [
    new PathLayer({
      id: "rail-glow",
      data: glowRoutes,
      getPath: (d: { path: [number, number][] }) => d.path,
      getColor: [58, 208, 222, glowAlpha],
      getWidth: routeWidth(zoom) + 2.5,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      parameters: { depthTest: false }
    }),
    new PathLayer({
      id: "rail-routes",
      data: routes,
      getPath: (d: RailRoute & { path: [number, number][] }) => d.path,
      getColor: (d: RailRoute) => routeColor(d, dimNetwork),
      getWidth: routeWidth(zoom),
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      parameters: { depthTest: false }
    }),
    new ScatterplotLayer({
      id: "rail-stations",
      data: stations,
      getPosition: (d: RailStation) => [d.lng, d.lat],
      getRadius: zoom >= 8 ? 3.5 : 2.5,
      radiusUnits: "pixels",
      getFillColor: [140, 155, 170, zoom >= 5 ? (dimNetwork ? 120 : 200) : 140],
      getLineColor: [20, 24, 32, 200],
      lineWidthMinPixels: 1,
      stroked: true,
      parameters: { depthTest: false }
    })
  ];

  if (labelStations.length > 0) {
    layers.push(
      new TextLayer({
        id: "rail-station-labels",
        data: labelStations,
        getPosition: (d: RailStation) => [d.lng, d.lat],
        getText: (d: RailStation) => d.code,
        getSize: 11,
        getColor: [153, 161, 173, dimNetwork ? 140 : 220],
        getPixelOffset: [0, 10],
        fontFamily: "monospace",
        fontWeight: 600,
        characterSet: "auto",
        getTextAnchor: "middle",
        getAlignmentBaseline: "top",
        billboard: true,
        parameters: { depthTest: false }
      })
    );
  }

  return layers;
}

/** Draw the ACTUAL corridor track (backend sections) under the live trains —
 *  bright and always visible, only lightly dimmed when a train is selected. */
export function buildCorridorRailLayers(
  sections: { id: string; geometry: LngLat[]; ghat?: boolean; line?: string }[],
  stations: { lng: number; lat: number }[],
  zoom: number,
  dim: boolean
): Layer[] {
  const w = routeWidth(zoom);
  const lines = sections.filter((s) => s.geometry && s.geometry.length > 1);
  return [
    new PathLayer({
      id: "corridor-rail-glow",
      data: lines,
      getPath: (d) => d.geometry,
      getColor: [70, 150, 200, dim ? 40 : 75],
      getWidth: w + 4,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      parameters: { depthTest: false }
    }),
    new PathLayer({
      id: "corridor-rail",
      data: lines,
      getPath: (d) => d.geometry,
      getColor: (d) =>
        d.ghat || d.line === "single"
          ? [214, 173, 78, dim ? 175 : 240]
          : [129, 169, 198, dim ? 165 : 235],
      getWidth: w + 1,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      parameters: { depthTest: false }
    }),
    new ScatterplotLayer({
      id: "corridor-stations",
      data: stations,
      getPosition: (d) => [d.lng, d.lat],
      getRadius: zoom >= 9 ? 4 : 3,
      radiusUnits: "pixels",
      getFillColor: [206, 214, 226, dim ? 170 : 235],
      getLineColor: [18, 22, 30, 220],
      lineWidthMinPixels: 1,
      stroked: true,
      parameters: { depthTest: false }
    })
  ];
}

function buildSelectedRouteLayer(selected: TrainSnapshot, zoom: number): Layer[] {
  return [
    new PathLayer({
      id: "selected-route-glow",
      data: [{ path: selected.polyline }],
      getPath: (d: { path: [number, number][] }) => d.path,
      getColor: [58, 208, 222, 60],
      getWidth: routeWidth(zoom) + 8,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      parameters: { depthTest: false }
    }),
    new PathLayer({
      id: "selected-route",
      data: [{ path: selected.polyline }],
      getPath: (d: { path: [number, number][] }) => d.path,
      getColor: [58, 208, 222, 255],
      getWidth: routeWidth(zoom) + 3,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      parameters: { depthTest: false }
    })
  ];
}

function buildTrainLayers(
  zoom: number,
  trains: TrainSnapshot[],
  selectedTrainNumber: string | null,
  hoveredTrainNumber: string | null,
  frameTick: number
): Layer[] {
  if (trains.length === 0) return [];

  const moving = trains.filter((t) => t.active && t.speedKmh > 0.5);
  const trailData = moving
    .map((t) => ({
      train: t,
      path: buildTrackTrail(
        t.polyline,
        t.polyCumKm,
        t.distKm,
        trailLengthKm(t.speedKmh)
      )
    }))
    .filter((d) => d.path.length > 1);

  const labeled = trains.filter((t) =>
    labelTrain(t, zoom, selectedTrainNumber, hoveredTrainNumber)
  );

  const layers: Layer[] = [];

  if (trailData.length > 0) {
    layers.push(
      new PathLayer({
        id: "train-trails-glow",
        data: trailData,
        getPath: (d: { path: [number, number][] }) => d.path,
        getColor: (d: { train: TrainSnapshot }) => {
          const c = statusColor(d.train.status);
          return [c[0], c[1], c[2], 55];
        },
        getWidth: 7,
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
        parameters: { depthTest: false },
        updateTriggers: { getPath: frameTick, getColor: frameTick }
      }),
      new PathLayer({
        id: "train-trails",
        data: trailData,
        getPath: (d: { path: [number, number][] }) => d.path,
        getColor: (d: { train: TrainSnapshot }) => {
          const c = statusColor(d.train.status);
          return [c[0], c[1], c[2], 190];
        },
        getWidth: 2.5,
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
        parameters: { depthTest: false },
        updateTriggers: { getPath: frameTick, getColor: frameTick }
      })
    );
  }

  // Radar ping: moving trains emit an expanding, fading halo so the map reads
  // as live even when geographic drift is slow at city zoom. Purely visual.
  const pulse = 0.5 + 0.5 * Math.sin(frameTick * 0.08);
  if (moving.length > 0) {
    layers.push(
      new ScatterplotLayer({
        id: "trains-pulse",
        data: moving,
        getPosition: (d: TrainSnapshot) => d.position,
        getRadius: (d: TrainSnapshot) =>
          (d.number === selectedTrainNumber ? 14 : 10) + pulse * 6,
        radiusUnits: "pixels",
        getFillColor: (d: TrainSnapshot) => {
          const c = statusColor(d.status);
          return [c[0], c[1], c[2], Math.round(30 * (1 - pulse))];
        },
        parameters: { depthTest: false },
        pickable: false,
        updateTriggers: {
          getPosition: frameTick,
          getRadius: [frameTick, selectedTrainNumber],
          getFillColor: frameTick
        }
      })
    );
  }

  layers.push(
    new ScatterplotLayer({
      id: "trains-glow",
      data: trains,
      getPosition: (d: TrainSnapshot) => d.position,
      getRadius: (d: TrainSnapshot) =>
        d.number === selectedTrainNumber ? 16 : d.number === hoveredTrainNumber ? 13 : 10,
      radiusUnits: "pixels",
      getFillColor: (d: TrainSnapshot) => {
        const c = statusColor(d.status);
        return [c[0], c[1], c[2], 75];
      },
      parameters: { depthTest: false },
      pickable: false,
      updateTriggers: { getPosition: frameTick, getRadius: [selectedTrainNumber, hoveredTrainNumber] }
    }),
    new IconLayer({
      id: "trains",
      data: trains,
      getIcon: () => TRAIN_ICON as never,
      getPosition: (d: TrainSnapshot) => d.position,
      getAngle: (d: TrainSnapshot) => -d.bearing,
      getSize: (d: TrainSnapshot) =>
        d.number === selectedTrainNumber ? 26 : d.number === hoveredTrainNumber ? 23 : 20,
      sizeUnits: "pixels",
      billboard: true,
      parameters: { depthTest: false },
      getColor: (d: TrainSnapshot) => statusColor(d.status),
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 120],
      updateTriggers: {
        getPosition: frameTick,
        getAngle: frameTick,
        getColor: frameTick,
        getSize: [selectedTrainNumber, hoveredTrainNumber]
      }
    })
  );

  if (labeled.length > 0) {
    layers.push(
      new TextLayer({
        id: "train-labels",
        data: labeled,
        getPosition: (d: TrainSnapshot) => d.position,
        getText: (d: TrainSnapshot) => d.number,
        getSize: (d: TrainSnapshot) => (d.number === selectedTrainNumber ? 13 : 11),
        getColor: [236, 240, 245, 255],
        getPixelOffset: [0, -18],
        fontFamily: "monospace",
        fontWeight: 700,
        characterSet: "auto",
        getTextAnchor: "middle",
        getAlignmentBaseline: "bottom",
        billboard: true,
        // dark pill behind each number so it stays legible over track + satellite
        background: true,
        getBackgroundColor: (d: TrainSnapshot) => {
          const c = statusColor(d.status);
          return d.number === selectedTrainNumber ? [c[0], c[1], c[2], 230] : [12, 16, 22, 210];
        },
        getBorderColor: (d: TrainSnapshot) => {
          const c = statusColor(d.status);
          return [c[0], c[1], c[2], 230];
        },
        getBorderWidth: 1,
        backgroundPadding: [5, 2, 5, 2],
        parameters: { depthTest: false },
        updateTriggers: {
          getPosition: frameTick,
          getSize: [selectedTrainNumber],
          getBackgroundColor: [selectedTrainNumber, frameTick],
          data: [selectedTrainNumber, hoveredTrainNumber, zoom, frameTick]
        }
      })
    );
  }

  return layers;
}

function buildConflictLayers(
  conflicts: Conflict[],
  plans: ResolutionPlan[],
  sectionMap: Record<string, { geometry: LngLat[] }>,
  frameTick: number,
  zoom: number
): Layer[] {
  if (conflicts.length === 0) return [];

  const pulse = 0.5 + 0.5 * Math.sin(frameTick * 0.12);
  const width = routeWidth(zoom);

  const conflictData = conflicts
    .map((c) => {
      const path = sectionGeometry(c.location, sectionMap);
      return path && path.length > 1 ? { conflict: c, path } : null;
    })
    .filter((d): d is { conflict: Conflict; path: LngLat[] } => d != null);

  if (conflictData.length === 0) return [];

  const layers: Layer[] = [
    new PathLayer({
      id: "conflict-pulse-glow",
      data: conflictData,
      getPath: (d: { path: LngLat[] }) => d.path,
      getColor: (d: { conflict: Conflict }) => {
        const alpha = Math.round(45 + pulse * 90);
        return d.conflict.severity === "critical"
          ? [255, 55, 55, alpha]
          : [255, 170, 50, alpha];
      },
      getWidth: width + 10 + pulse * 8,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      parameters: { depthTest: false },
      updateTriggers: { getColor: frameTick, getWidth: frameTick }
    }),
    new PathLayer({
      id: "conflict-pulse",
      data: conflictData,
      getPath: (d: { path: LngLat[] }) => d.path,
      getColor: (d: { conflict: Conflict }) =>
        d.conflict.severity === "critical"
          ? [255, 80, 80, Math.round(160 + pulse * 80)]
          : [255, 190, 70, Math.round(140 + pulse * 70)],
      getWidth: width + 4 + pulse * 3,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      parameters: { depthTest: false },
      updateTriggers: { getColor: frameTick, getWidth: frameTick }
    })
  ];

  const planData = conflicts
    .filter((c) => plans.some((p) => p.conflictId === c.id && p.verified))
    .map((c) => {
      const path = sectionGeometry(c.location, sectionMap);
      return path && path.length > 1 ? { path } : null;
    })
    .filter((d): d is { path: LngLat[] } => d != null);

  if (planData.length > 0) {
    layers.push(
      new PathLayer({
        id: "plan-reroute",
        data: planData,
        getPath: (d: { path: LngLat[] }) => d.path,
        getColor: [58, 208, 222, 220],
        getWidth: width + 2,
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
        getDashArray: [10, 7],
        dashJustified: true,
        dashGapPickable: false,
        parameters: { depthTest: false }
      })
    );
  }

  return layers;
}

export function buildDynamicMapLayers(opts: {
  zoom: number;
  selectedTrainNumber: string | null;
  hoveredTrainNumber: string | null;
  trains: TrainSnapshot[];
  selectedTrain: TrainSnapshot | null;
  conflicts?: Conflict[];
  plans?: ResolutionPlan[];
  sectionMap?: Record<string, { geometry: LngLat[] }>;
  frameTick?: number;
}): Layer[] {
  const {
    zoom,
    selectedTrainNumber,
    hoveredTrainNumber,
    trains,
    selectedTrain,
    conflicts = [],
    plans = [],
    sectionMap = {},
    frameTick = 0
  } = opts;

  const layers: Layer[] = [];

  if (conflicts.length > 0 && Object.keys(sectionMap).length > 0) {
    layers.push(...buildConflictLayers(conflicts, plans, sectionMap, frameTick, zoom));
  }

  if (selectedTrain) {
    layers.push(...buildSelectedRouteLayer(selectedTrain, zoom));
  }
  layers.push(
    ...buildTrainLayers(zoom, trains, selectedTrainNumber, hoveredTrainNumber, frameTick)
  );
  return layers;
}

export function buildMapLayers(opts: MapLayerOptions): Layer[] {
  const {
    bounds,
    zoom,
    selectedTrainNumber,
    hoveredTrainNumber,
    trains,
    selectedTrain,
    dimNetwork,
    frameTick = 0
  } = opts;
  const dim = dimNetwork ?? Boolean(selectedTrainNumber);

  const layers = buildRailLayers(bounds, zoom, dim);
  layers.push(
    ...buildDynamicMapLayers({
      zoom,
      selectedTrainNumber,
      hoveredTrainNumber,
      trains,
      selectedTrain,
      frameTick
    })
  );
  return layers;
}

export function isTrainPick(
  info: PickingInfo
): info is PickingInfo<TrainSnapshot> & { object: TrainSnapshot } {
  return Boolean(info.object && info.layer?.id === "trains");
}

export function statusLabel(status: TrainStatus): string {
  switch (status) {
    case "conflict":
      return "Conflict";
    case "delayed":
      return "Delayed";
    case "held":
      return "Held";
    case "scheduled":
      return "Scheduled";
    case "arrived":
      return "Arrived";
    default:
      return "On time";
  }
}

/** Backward-compatible alias used before Phase 4 split. */
export function buildRailNetworkLayers(opts: {
  bounds: ViewBounds;
  zoom: number;
}): Layer[] {
  return buildRailLayers(opts.bounds, opts.zoom, false);
}
