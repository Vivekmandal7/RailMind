import { IconLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { ScenegraphLayer } from "@deck.gl/mesh-layers";
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
import { sectionGeometry } from "./twinBridge";
import type { Conflict, ResolutionPlan } from "./types";

/**
 * Real 3D locomotive (glTF/glb) rendered on top of the real track geometry with live
 * motion. Model is CC0 (public domain): Quaternius' "Locomotive Front" via poly.pizza,
 * downloaded into frontend/public/models/loco_front.glb.
 *
 * The model is authored at real-ish scale (~10.4 m long × 2.7 wide × 2.1 tall in its
 * own units), so sizeScale is SMALL — multiplying it by thousands turns one loco into a
 * kilometres-long ribbon. We render ONE locomotive per train, placed at the live
 * position, oriented to the track bearing, tinted by status, and bumped up modestly so
 * it reads clearly on the map when the "3D" close-up is engaged.
 *
 * (The pack's coach + high-speed models are near-flat / low quality, so we don't use
 *  them — a single clean locomotive looks far more like a real train.)
 */
const MODEL_LOCO = "/models/loco_front.glb";

const TRAIN_3D = {
  /** model-units -> world metres. Model is ~10.4 units long, so this ≈ a 60 m loco. */
  sizeScale: 6,
  /** floor/ceiling in screen pixels so it stays visible without ballooning */
  sizeMinPixels: 8,
  sizeMaxPixels: 90,
  /** added to (-bearing) yaw so the model's long axis points along travel (deg) */
  yawOffset: 90,
  /** roll about the forward axis to stand the model upright in deck z-up space (deg) */
  roll: 0
};

function trainOrientation(bearing: number): [number, number, number] {
  // deck.gl ScenegraphLayer orientation = [pitch, yaw, roll]. Yaw rotates the model
  // about its up axis; -bearing makes it track the heading (bearing is CW-from-north).
  return [0, TRAIN_3D.yawOffset - bearing, TRAIN_3D.roll];
}

/** The glb loco is untextured grey/dark, so we multiply it by the train's live status
 *  colour (green on-time, amber delayed, red held/conflict), brightened so the dark
 *  engine still reads clearly. */
function trainTint(t: TrainSnapshot): [number, number, number] {
  const c = statusColor(t.status);
  return [
    Math.min(255, c[0] + 60),
    Math.min(255, c[1] + 60),
    Math.min(255, c[2] + 60)
  ];
}

/** Small geo offset to place marker lights a few meters ahead/behind the train icon.
 *  This makes the blinking lights sit at the actual "ends" of the train, like real marker lights.
 */
function offsetPosition(
  pos: LngLat,
  bearingDeg: number,
  meters: number
): LngLat {
  const R = 6378137; // WGS84 meters
  const d = meters / R;
  const br = (bearingDeg * Math.PI) / 180;
  const lat1 = (pos[1] * Math.PI) / 180;
  const lng1 = (pos[0] * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(br) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );

  return [(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

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

  const w = routeWidth(zoom);
  // Real railway look: wide dark ballast/formation bed first (earth + gravel), then the steel rail on top.
  // This makes the "real railway" visible as proper track infrastructure rather than a thin abstract line.
  const ballastColor: [number, number, number, number] = dimNetwork ? [42, 46, 52, 70] : [48, 52, 58, 140];
  const railLayers: Layer[] = [
    new PathLayer({
      id: "rail-ballast",
      data: routes,
      getPath: (d: RailRoute & { path: [number, number][] }) => d.path,
      getColor: ballastColor,
      getWidth: w + 7,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      parameters: { depthTest: false }
    }),
    new PathLayer({
      id: "rail-glow",
      data: glowRoutes,
      getPath: (d: { path: [number, number][] }) => d.path,
      getColor: [58, 208, 222, glowAlpha],
      getWidth: w + 2.5,
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
      getWidth: w,
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
  const layers: Layer[] = railLayers;

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
export interface CorridorStation {
  code: string;
  name: string;
  lat: number;
  lng: number;
  platforms: number;
}

export function buildCorridorRailLayers(
  sections: { id: string; geometry: LngLat[]; ghat?: boolean; line?: string }[],
  stations: CorridorStation[],
  zoom: number,
  dim: boolean
): Layer[] {
  const w = routeWidth(zoom);
  const lines = sections.filter((s) => s.geometry && s.geometry.length > 1);
  // Real railway corridor: ballast bed (formation) + steel rails on top using the actual
  // high-resolution section geometry from the backend. This is the "real railway" the trains
  // are moving on with live animation.
  const ballast: [number, number, number, number] = dim ? [38, 42, 48, 55] : [44, 48, 54, 125];
  return [
    new PathLayer({
      id: "corridor-rail-ballast",
      data: lines,
      getPath: (d) => d.geometry,
      getColor: ballast,
      getWidth: w + 8,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      parameters: { depthTest: false }
    }),
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
      getRadius: zoom >= 9 ? 4.5 : 3.5,
      radiusUnits: "pixels",
      radiusMinPixels: 4,
      getFillColor: [206, 214, 226, dim ? 170 : 235],
      getLineColor: [18, 22, 30, 220],
      lineWidthMinPixels: 1,
      stroked: true,
      pickable: true,
      parameters: { depthTest: false }
    })
  ];
}

export function isStationPick(
  info: PickingInfo
): info is PickingInfo<CorridorStation> & { object: CorridorStation } {
  return Boolean(info.object && info.layer?.id === "corridor-stations");
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
  frameTick: number,
  show3DTrains = false
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
  // Speed modulates intensity + size → fast expresses feel energetic, locals calmer.
  const pulse = 0.5 + 0.5 * Math.sin(frameTick * 0.08);
  if (moving.length > 0) {
    layers.push(
      new ScatterplotLayer({
        id: "trains-pulse",
        data: moving,
        getPosition: (d: TrainSnapshot) => d.position,
        getRadius: (d: TrainSnapshot) => {
          const base = (d.number === selectedTrainNumber ? 14 : 10) + pulse * 6;
          const speedBoost = Math.min(9, (d.speedKmh || 0) / 35);
          return base + speedBoost;
        },
        radiusUnits: "pixels",
        getFillColor: (d: TrainSnapshot) => {
          const c = statusColor(d.status);
          const speedA = Math.max(0.35, Math.min(0.95, ((d.speedKmh || 40) / 120)));
          return [c[0], c[1], c[2], Math.round(26 * (1 - pulse) * speedA)];
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
      getRadius: (d: TrainSnapshot) => {
        const base = d.number === selectedTrainNumber ? 17 : d.number === hoveredTrainNumber ? 14 : 10;
        const spd = d.speedKmh || 0;
        // Fast trains have a bigger "presence" halo; nearly-stopped (dwells) are tight & calm.
        const speedScale = 1 + Math.min(0.7, spd / 90);
        return base * speedScale;
      },
      radiusUnits: "pixels",
      getFillColor: (d: TrainSnapshot) => {
        const c = statusColor(d.status);
        const spd = d.speedKmh || 0;
        // Stopped/dwelling trains have a subtler glow so the eye rests on moving traffic.
        const a = spd < 3 ? 38 : 75;
        return [c[0], c[1], c[2], a];
      },
      parameters: { depthTest: false },
      pickable: true, // 2D hit target so map clicks / hover select the train (real motion target)
      updateTriggers: { getPosition: frameTick, getRadius: [selectedTrainNumber, hoveredTrainNumber], getFillColor: frameTick }
    })
  );

  // === Real 3D locomotive on the real track ===
  // Only when the user has pressed the "3D" button (map pitched). One correctly-scaled
  // locomotive per active train, sitting on the live position, pointing along the track
  // bearing, tinted by status. Status is also read off the colored glow + blinking lights.
  if (show3DTrains) {
    const active = trains.filter((t) => t.active);
    if (active.length > 0) {
      layers.push(
        new ScenegraphLayer<TrainSnapshot>({
          id: "trains-3d",
          data: active,
          scenegraph: MODEL_LOCO,
          getPosition: (t: TrainSnapshot) => t.position,
          getOrientation: (t: TrainSnapshot) => trainOrientation(t.bearing),
          getColor: (t: TrainSnapshot) => trainTint(t),
          getScale: (t: TrainSnapshot) => {
            const s =
              t.number === selectedTrainNumber
                ? 1.5
                : t.number === hoveredTrainNumber
                ? 1.2
                : 1.0;
            return [s, s, s];
          },
          sizeScale: TRAIN_3D.sizeScale,
          sizeMinPixels: TRAIN_3D.sizeMinPixels,
          sizeMaxPixels: TRAIN_3D.sizeMaxPixels,
          _lighting: "pbr",
          pickable: true,
          autoHighlight: true,
          highlightColor: [255, 255, 255, 110],
          updateTriggers: {
            getPosition: frameTick,
            getOrientation: frameTick,
            getColor: frameTick,
            getScale: [selectedTrainNumber, hoveredTrainNumber]
          }
        })
      );
    }
  }

  // === Realistic blinking marker lights (front + rear) ===
  // These sit slightly ahead/behind the train body (real meters along bearing).
  // Front = warm blinking headlight (like a real loco).
  // Rear = smaller steady red tail light.
  // Problem trains (held/conflict) turn the headlight urgent red.
  // Combined with the new colored train-shaped icon, this looks like actual trains
  // running on the tracks with their marker lights — very demo-friendly for judges.
  {
    const frontLights: any[] = [];
    const rearLights: any[] = [];

    for (const t of trains) {
      const spd = t.speedKmh || 0;
      const isProblem = t.status === "held" || t.status === "conflict";
      const isFast = spd > 25;

      // Front headlight ~20m ahead of the icon
      const frontPos = offsetPosition(t.position, t.bearing, 20);
      const frontPhase = Math.sin(frameTick * (isFast ? 0.22 : 0.14));
      const frontBlink = 0.55 + 0.45 * frontPhase;
      const frontAlpha = isProblem ? 230 : Math.round(160 + 80 * frontBlink);
      const frontColor = isProblem
        ? [255, 70, 70, frontAlpha]
        : [255, 235, 170, frontAlpha];

      frontLights.push({
        ...t,
        lightPos: frontPos,
        lightRadius: (isFast ? 4.2 : 3.2) * (0.7 + 0.3 * frontBlink),
        lightColor: frontColor
      });

      // Rear tail ~18m behind
      const rearBearing = (t.bearing + 180) % 360;
      const rearPos = offsetPosition(t.position, rearBearing, 18);
      const rearAlpha = spd < 3 ? 140 : 190;
      rearLights.push({
        ...t,
        lightPos: rearPos,
        lightRadius: 2.1,
        lightColor: [255, 90, 70, rearAlpha]
      });
    }

    if (frontLights.length > 0) {
      layers.push(
        new ScatterplotLayer({
          id: "train-front-lights",
          data: frontLights,
          getPosition: (d: any) => d.lightPos,
          getRadius: (d: any) => d.lightRadius,
          radiusUnits: "pixels",
          getFillColor: (d: any) => d.lightColor,
          parameters: { depthTest: false },
          pickable: false,
          updateTriggers: {
            getPosition: frameTick,
            getRadius: frameTick,
            getFillColor: frameTick
          }
        })
      );
    }

    if (rearLights.length > 0) {
      layers.push(
        new ScatterplotLayer({
          id: "train-rear-lights",
          data: rearLights,
          getPosition: (d: any) => d.lightPos,
          getRadius: (d: any) => d.lightRadius,
          radiusUnits: "pixels",
          getFillColor: (d: any) => d.lightColor,
          parameters: { depthTest: false },
          pickable: false,
          updateTriggers: {
            getPosition: frameTick,
            getRadius: frameTick,
            getFillColor: frameTick
          }
        })
      );
    }
  }

  if (labeled.length > 0) {
    layers.push(
      new TextLayer({
        id: "train-labels",
        data: labeled,
        getPosition: (d: TrainSnapshot) => d.position,
        // Number, plus the live speed on a second line while the train is actually moving
        // — so an operator can read which numbered train is running and how fast, right on
        // the map (not just in the side panel).
        getText: (d: TrainSnapshot) =>
          (d.speedKmh || 0) >= 2
            ? `${d.number}\n${Math.round(d.speedKmh)} km/h`
            : d.number,
        getSize: (d: TrainSnapshot) => (d.number === selectedTrainNumber ? 14 : 11),
        getColor: [236, 240, 245, 255],
        // Lift the label higher above the bigger 3D loco so it doesn't overlap the model.
        getPixelOffset: [0, show3DTrains ? -30 : -18],
        fontFamily: "monospace",
        fontWeight: 700,
        lineHeight: 1.15,
        characterSet: "auto",
        getTextAnchor: "middle",
        getAlignmentBaseline: "bottom",
        billboard: true,
        // dark pill behind each number so it stays legible over track + satellite
        background: true,
        getBackgroundColor: (d: TrainSnapshot) => {
          const c = statusColor(d.status);
          return d.number === selectedTrainNumber ? [c[0], c[1], c[2], 235] : [12, 16, 22, 215];
        },
        getBorderColor: (d: TrainSnapshot) => {
          const c = statusColor(d.status);
          return [c[0], c[1], c[2], 235];
        },
        getBorderWidth: (d: TrainSnapshot) => (d.number === selectedTrainNumber ? 2 : 1),
        backgroundPadding: [6, 3, 6, 3],
        parameters: { depthTest: false },
        updateTriggers: {
          getPosition: frameTick,
          getText: frameTick,
          getSize: [selectedTrainNumber],
          getPixelOffset: [show3DTrains],
          getBackgroundColor: [selectedTrainNumber, frameTick],
          getBorderWidth: [selectedTrainNumber],
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

export interface ClearedSection {
  path: LngLat[];
  frame: number; // frameTick when the conflict cleared
}

/** Green easing pulse on a section whose conflict just resolved — the visible
 *  "back to normal" so an operator knows the red alarm has actually cleared. */
function buildClearedLayers(
  cleared: ClearedSection[],
  frameTick: number,
  zoom: number
): Layer[] {
  const LIFE = 150; // frames (~2.5s @ 60fps)
  const live = cleared.filter((c) => frameTick - c.frame < LIFE);
  if (live.length === 0) return [];
  const w = routeWidth(zoom);
  return live.flatMap((c, i) => {
    const t = Math.min(1, (frameTick - c.frame) / LIFE); // 0 -> 1
    const alpha = Math.round(210 * (1 - t));
    return [
      new PathLayer({
        id: `cleared-glow-${i}`,
        data: [{ path: c.path }],
        getPath: (d: { path: LngLat[] }) => d.path,
        getColor: [52, 210, 122, Math.round(alpha * 0.45)],
        getWidth: w + 10 + t * 16,
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
        parameters: { depthTest: false },
        updateTriggers: { getColor: frameTick, getWidth: frameTick }
      }),
      new PathLayer({
        id: `cleared-${i}`,
        data: [{ path: c.path }],
        getPath: (d: { path: LngLat[] }) => d.path,
        getColor: [80, 230, 140, alpha],
        getWidth: w + 3,
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
        parameters: { depthTest: false },
        updateTriggers: { getColor: frameTick }
      })
    ];
  });
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
  cleared?: ClearedSection[];
  frameTick?: number;
  show3DTrains?: boolean;
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
    cleared = [],
    frameTick = 0,
    show3DTrains = false
  } = opts;

  const layers: Layer[] = [];

  if (cleared.length > 0) {
    layers.push(...buildClearedLayers(cleared, frameTick, zoom));
  }

  if (conflicts.length > 0 && Object.keys(sectionMap).length > 0) {
    layers.push(...buildConflictLayers(conflicts, plans, sectionMap, frameTick, zoom));
  }

  if (selectedTrain) {
    layers.push(...buildSelectedRouteLayer(selectedTrain, zoom));
  }
  layers.push(
    ...buildTrainLayers(zoom, trains, selectedTrainNumber, hoveredTrainNumber, frameTick, show3DTrains)
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
      frameTick,
      show3DTrains: false
    })
  );
  return layers;
}

const TRAIN_PICK_LAYERS = new Set(["trains", "trains-glow", "trains-3d"]);

export function isTrainPick(info: PickingInfo): boolean {
  // Picking targets: the 3D rake (loco / hispeed / coaches), the visible status glow
  // (2D), and the legacy id. Reliable in both flat and pitched 3D views, and works with
  // the overlay's pickingRadius.
  return Boolean(info.object && info.layer && TRAIN_PICK_LAYERS.has(info.layer.id));
}

/** Resolve the train number from a pick whether it hit a 2D marker (TrainSnapshot)
 *  or a 3D car (TrainCar, which nests the train). */
export function pickedTrainNumber(info: PickingInfo): string | null {
  if (!isTrainPick(info)) return null;
  const o = info.object as Partial<TrainSnapshot> & { train?: TrainSnapshot };
  return o.train?.number ?? o.number ?? null;
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
