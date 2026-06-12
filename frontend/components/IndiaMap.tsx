"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { PickingInfo } from "@deck.gl/core";
import {
  INDIA_BOUNDS,
  INDIA_FIT_PADDING,
  INDIA_FLY_DURATION_MS,
  MAPBOX_DARK_STYLE,
  MAPBOX_SATELLITE_STYLE
} from "@/lib/indiaViewport";
import { boundsFromMap, loadIndiaRailNetwork, pointInBounds, type LngLat } from "@/lib/indiaRailNetwork";
import {
  buildCorridorRailLayers,
  buildDynamicMapLayers,
  buildRailLayers,
  isStationPick,
  isTrainPick,
  pickedTrainNumber
} from "@/lib/mapLayers";
import { interpAlong } from "@/lib/geo";
import {
  STATIC_SIM_SEC,
  computeTrainSnapshot,
  computeVisibleSnapshots,
  findTrainDefinition,
  loadTrainDefinitions,
  type TrainDefinition,
  type TrainSnapshot
} from "@/lib/indiaTrains";
import { SIM_MAX_SEC, SIM_MIN_SEC, type SimSpeedPreset } from "@/lib/trainIcons";
import {
  TwinInterpolator,
  metaFromStore,
  sectionGeometry
} from "@/lib/twinBridge";
import { useStore } from "@/store/useStore";
import TrainDetailPanel from "@/components/TrainDetailPanel";
import StationView from "@/components/StationView";
import TrainSearch from "@/components/TrainSearch";
import SimClockBar from "@/components/SimClockBar";
import MapLegend from "@/components/MapLegend";
import RailInfraControl from "@/components/RailInfraControl";
import { applyOrmOverlay } from "@/lib/ormOverlay";
import { DemoCaption } from "@/components/DemoMode";
import { isBenignMapNetworkError } from "@/lib/mapNetworkErrors";
import "mapbox-gl/dist/mapbox-gl.css";

/** Dark base used everywhere (matches tailwind `base`). */
const MAP_BG = "#0B0D11";

/** Force the map's base/background to the dark control-room colour so the satellite
 *  style's white background never flashes through at the edges while tiles stream in
 *  (was a white strip at the top of the map as the camera panned with a train). */
function themeMapBackground(map: mapboxgl.Map): void {
  try {
    if (map.getLayer("background")) {
      map.setPaintProperty("background", "background-color", MAP_BG);
    } else {
      const firstId = map.getStyle()?.layers?.[0]?.id;
      map.addLayer(
        { id: "railmind-bg", type: "background", paint: { "background-color": MAP_BG } },
        firstId
      );
    }
  } catch {
    /* style not ready / layer locked — safe to ignore */
  }
}

/** Status dot colour for the "now following" HUD chip (matches the map legend). */
const HUD_STATUS_COLOR: Record<string, string> = {
  running: "#37D99A",
  onTime: "#37D99A",
  scheduled: "#37D99A",
  delayed: "#F5B027",
  held: "#FF5C5C",
  conflict: "#FF5C5C",
  arrived: "#99A1AD"
};

function boundsFromPolyline(path: LngLat[]): [[number, number], [number, number]] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of path) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat]
  ];
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  return e.name === "AbortError" || /aborted/i.test(e.message ?? "");
}

/** Mapbox remove() can throw AbortError while in-flight tile/style fetches cancel. */
function disposeMapboxMap(map: mapboxgl.Map, overlay: MapboxOverlay | null) {
  const teardown = () => {
    if (overlay) {
      try {
        map.removeControl(overlay);
      } catch (err) {
        if (!isAbortError(err)) console.warn("[Mapbox] removeControl", err);
      }
      try {
        overlay.finalize();
      } catch (err) {
        if (!isAbortError(err)) console.warn("[Mapbox] overlay finalize", err);
      }
    }
    try {
      map.remove();
    } catch (err) {
      if (!isAbortError(err)) console.warn("[Mapbox] remove", err);
    }
  };

  if (map.isStyleLoaded()) {
    teardown();
  } else {
    map.once("load", teardown);
  }
}

function clampSimSec(sec: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, sec));
}

function buildIndiaSectionMap(): Record<string, { geometry: LngLat[] }> {
  const net = loadIndiaRailNetwork();
  const map: Record<string, { geometry: LngLat[] }> = {};
  for (const r of net.routes) {
    map[r.id] = { geometry: r.geometry };
    map[`${r.to}-${r.from}`] = { geometry: [...r.geometry].reverse() };
  }
  return map;
}

export default function IndiaMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const moveRafRef = useRef(0);
  const animRafRef = useRef(0);

  const selectedRef = useRef<string | null>(null);
  const hoveredRef = useRef<string | null>(null);
  // conflict-id -> section location, to detect when a conflict clears
  const prevConflictMetaRef = useRef<Map<string, string>>(new Map());
  const clearedRef = useRef<Map<string, { path: LngLat[]; frame: number }>>(new Map());
  const simSecRef = useRef(STATIC_SIM_SEC);
  const playingRef = useRef(true);
  const speedRef = useRef<SimSpeedPreset>(15);
  const frameTickRef = useRef(0);
  const is3DRef = useRef(false);
  const railLayersRef = useRef<ReturnType<typeof buildRailLayers>>([]);
  const interpolatorRef = useRef(new TwinInterpolator());
  const lastLiveTrainsRef = useRef<TrainSnapshot[]>([]);
  const smoothBearingRef = useRef<Record<string, number>>({});
  const trackTrainRef = useRef<string | null>(null);
  const lastFollowUpdateRef = useRef(0);
  const lastUserGestureRef = useRef(0);
  const indiaSectionMap = useMemo(() => buildIndiaSectionMap(), []);

  const mode = useStore((s) => s.mode);
  const connected = useStore((s) => s.connected);
  const liveStates = useStore((s) => s.states);
  const lastSnapshotAt = useStore((s) => s.lastSnapshotAt);
  const conflicts = useStore((s) => s.conflicts);
  const plans = useStore((s) => s.plans);
  const storeSimSec = useStore((s) => s.simSec);
  const storePlaying = useStore((s) => s.playing);
  const storeSpeed = useStore((s) => s.speed);
  const windowStart = useStore((s) => s.windowStart);
  const windowEnd = useStore((s) => s.windowEnd);
  const trainGeom = useStore((s) => s.trainGeom);
  const trainMeta = useStore((s) => s.trainMeta);
  const net = useStore((s) => s.net);
  const setPlayingStore = useStore((s) => s.setPlaying);
  const setSpeedStore = useStore((s) => s.setSpeed);
  const scrubStore = useStore((s) => s.scrub);
  const syncLocalSim = useStore((s) => s.syncLocalSim);
  const trackTrain = useStore((s) => s.trackTrain);
  const focusConflictId = useStore((s) => s.focusConflictId);
  const fitRoute = useStore((s) => s.fitRoute);
  const setFitRoute = useStore((s) => s.setFitRoute);
  const mapResetSeq = useStore((s) => s.mapResetSeq);
  const selectTrainStore = useStore((s) => s.selectTrain);
  const localConflicts = useStore((s) => s.conflicts);
  const localPlans = useStore((s) => s.plans);

  const isLive = mode === "live" && connected;
  const isLiveRef = useRef(isLive);
  isLiveRef.current = isLive;

  const [selectedNumber, setSelectedNumber] = useState<string | null>(null);
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [hoveredNumber, setHoveredNumber] = useState<string | null>(null);
  const [simSecDisplay, setSimSecDisplay] = useState(STATIC_SIM_SEC);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<SimSpeedPreset>(15);
  const [is3D, setIs3D] = useState(false);
  const [satellite, setSatellite] = useState(false);
  // The actual loaded map, captured in its own `load` event. Held in STATE (not
  // just the ref) so the corridor-fit effect re-runs with a guaranteed-valid map
  // reference — robust to StrictMode's mount/dispose/mount race on the ref.
  const [loadedMap, setLoadedMap] = useState<mapboxgl.Map | null>(null);
  const [detailSnap, setDetailSnap] = useState<TrainSnapshot | null>(null);
  const [followHud, setFollowHud] = useState<{
    number: string;
    name?: string;
    speed: number;
    status: string;
  } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const lastMapResetRef = useRef(0);

  // OpenRailwayMap infrastructure overlay (shared with RailInfraControl + legend).
  const ormStyle = useStore((s) => s.ormStyle);
  const ormOpacity = useStore((s) => s.ormOpacity);
  const ormRef = useRef({ style: ormStyle, opacity: ormOpacity });
  ormRef.current = { style: ormStyle, opacity: ormOpacity };

  /** Bounds of the live corridor (from its real station coords) so we frame the
   *  trains on connect instead of dumping the user on an all-Asia view. */
  const corridorBounds = useMemo<[[number, number], [number, number]] | null>(() => {
    if (!isLive) return null;
    const coords = Object.values(net.stationMap).map((s) => [s.lng, s.lat] as LngLat);
    if (coords.length < 2) return null;
    return boundsFromPolyline(coords);
  }, [isLive, net]);
  const corridorBoundsRef = useRef(corridorBounds);
  corridorBoundsRef.current = corridorBounds;

  /** Frame the corridor (live) or all-India (local) on the given map. */
  const frameInitialView = useCallback((map: mapboxgl.Map) => {
    const b = corridorBoundsRef.current;
    if (isLiveRef.current && b) {
      map.fitBounds(b, { padding: 90, maxZoom: 11, duration: 0, essential: true });
    } else {
      map.fitBounds(INDIA_BOUNDS, { padding: INDIA_FIT_PADDING, duration: 0 });
    }
  }, []);
  const frameInitialViewRef = useRef(frameInitialView);
  frameInitialViewRef.current = frameInitialView;

  selectedRef.current = selectedNumber;
  hoveredRef.current = hoveredNumber;
  is3DRef.current = is3D;
  trackTrainRef.current = trackTrain;

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

  const sectionMap = isLive ? net.sectionMap : indiaSectionMap;
  const mapConflicts = isLive ? conflicts : localConflicts;
  const mapPlans = isLive ? plans : localPlans;

  useEffect(() => {
    if (isLive) {
      interpolatorRef.current.ingest(liveStates, lastSnapshotAt);
      simSecRef.current = storeSimSec;
      setSimSecDisplay(storeSimSec);
      setPlaying(storePlaying);
      setSpeed(storeSpeed as SimSpeedPreset);
      playingRef.current = storePlaying;
      speedRef.current = storeSpeed as SimSpeedPreset;
    } else if (mode === "local") {
      interpolatorRef.current.reset();
      // Keep local refs aligned so RAF render + controls behave; store is authoritative for advance.
      playingRef.current = storePlaying;
      speedRef.current = (storeSpeed as SimSpeedPreset) ?? 60;
      simSecRef.current = storeSimSec;
      setSimSecDisplay(storeSimSec);
    }
  }, [isLive, mode, liveStates, lastSnapshotAt, storeSimSec, storePlaying, storeSpeed]);

  const mergeOverlayLayers = useCallback(
    (
      trains: TrainSnapshot[],
      selectedTrain: TrainSnapshot | null,
      frameTick: number
    ) => {
      const map = mapRef.current;
      const overlay = overlayRef.current;
      if (!map || !overlay) return;

      // Detect conflicts that just cleared → schedule a green "back to normal"
      // flash on their section so the operator sees the red alarm resolve.
      const curMeta = new Map(mapConflicts.map((c) => [c.id, c.location]));
      for (const id of curMeta.keys()) clearedRef.current.delete(id); // re-detected
      for (const [id, loc] of prevConflictMetaRef.current) {
        if (!curMeta.has(id) && !clearedRef.current.has(id)) {
          const path = sectionGeometry(loc, sectionMap);
          if (path && path.length > 1) clearedRef.current.set(id, { path, frame: frameTick });
        }
      }
      prevConflictMetaRef.current = curMeta;
      for (const [id, e] of clearedRef.current) {
        if (frameTick - e.frame > 170) clearedRef.current.delete(id);
      }

      const zoom = map.getZoom();
      overlay.setProps({
        layers: [
          ...railLayersRef.current,
          ...buildDynamicMapLayers({
            zoom,
            selectedTrainNumber: selectedRef.current,
            hoveredTrainNumber: hoveredRef.current,
            trains,
            selectedTrain,
            conflicts: mapConflicts,
            plans: mapPlans,
            sectionMap,
            cleared: Array.from(clearedRef.current.values()),
            frameTick,
            show3DTrains: is3DRef.current
          })
        ]
      });
    },
    [mapConflicts, mapPlans, sectionMap]
  );

  const rebuildRailCache = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const zoom = map.getZoom();
    const dim = Boolean(selectedRef.current);
    // Live mode: draw the REAL corridor track (backend sections) so there is
    // always a clear, bright line directly under the trains. National/local
    // fallback uses the bundled India rail network.
    if (isLive && net.sections.length > 0) {
      railLayersRef.current = buildCorridorRailLayers(
        net.sections as never,
        net.stations,
        zoom,
        dim
      );
    } else {
      railLayersRef.current = buildRailLayers(boundsFromMap(map), zoom, dim);
    }
  }, [isLive, net]);

  const renderFrame = useCallback(
    (dtReal = 0) => {
      const map = mapRef.current;
      if (!map) return;

      const bounds = boundsFromMap(map);
      const selected = selectedRef.current;
      let trains: TrainSnapshot[] = [];
      let selectedTrain: TrainSnapshot | null = null;

      if (isLive) {
        const meta = metaFromStore(trainMeta);
        const allLive = interpolatorRef.current.step(dtReal, trainGeom, meta);
        lastLiveTrainsRef.current = allLive;
        trains = allLive.filter(
          (t) =>
            pointInBounds(t.position[0], t.position[1], bounds) || t.number === selected
        );
        selectedTrain = selected
          ? allLive.find((t) => t.number === selected) ?? null
          : null;
      } else {
        // Local: derive snapshots from the single store simulation (now uses eased kinematics).
        // This makes map icons, roster speeds, ETAs, and conflict detection perfectly consistent.
        const st = useStore.getState();
        const activeStates = st.states.filter((t) => t.active || t.number === selected);
        const geomMap = st.trainGeom;
        const netTrains = st.net.trains;
        const netTrainByNum: Record<string, any> = {};
        for (const nt of netTrains) netTrainByNum[nt.number] = nt;

        const toSnap = (s: any): TrainSnapshot => {
          const g = geomMap[s.number];
          const nt = netTrainByNum[s.number];
          const poly = g?.polyline ?? nt?.polyline ?? [];
          const cum = g?.cum ?? nt?.polyCumKm ?? [];
          return {
            number: s.number,
            name: s.name,
            routeStations: nt?.route ?? [],
            polyline: poly,
            polyCumKm: cum,
            position: s.position,
            bearing: s.bearing,
            distKm: s.distKm,
            speedKmh: s.speedKmh,
            status: s.status,
            delayMinutes: s.delayMinutes,
            estPassengers: s.estPassengers,
            nextStation: s.nextStation,
            prevStation: s.prevStation,
            etaNextSec: s.etaNextSec,
            etaFinalSec: s.etaFinalSec ?? 0,
            active: s.active
          };
        };

        const inViewPos = (pos: LngLat) => pointInBounds(pos[0], pos[1], bounds);
        const cand = activeStates.map(toSnap);
        trains = cand.filter((t) => inViewPos(t.position) || t.number === selected);
        if (selected && !trains.some((t) => t.number === selected)) {
          // The selected number can reference a train the local sim doesn't
          // know (e.g. selection made in live mode before a fallback) —
          // toSnap(undefined) here used to crash the whole map.
          const fallbackState = st.states.find((x: any) => x.number === selected);
          const sel =
            cand.find((t) => t.number === selected) ??
            (fallbackState ? toSnap(fallbackState) : null);
          if (sel) trains = [...trains, sel];
        }
        selectedTrain = selected ? trains.find((t) => t.number === selected) ?? null : null;

        // Smooth bearing per-train so icons rotate fluidly across polyline kinks (realistic "steering").
        trains = trains.map((t) => {
          const prev = smoothBearingRef.current[t.number] ?? t.bearing;
          const d = ((t.bearing - prev + 540) % 360) - 180;
          const nb = prev + d * 0.22;
          smoothBearingRef.current[t.number] = nb;
          return { ...t, bearing: nb };
        });
        if (selectedTrain) {
          const sb = smoothBearingRef.current[selectedTrain.number] ?? selectedTrain.bearing;
          selectedTrain = { ...selectedTrain, bearing: sb };
        }

        // Keep the detail panel live for the tracked/selected train so numbers (speed, next ETA, pax)
        // visibly update in real time as the eased simulation walks the train along the track.
        const important = selected || trackTrainRef.current;
        if (important) {
          const liveSnap = trains.find((t) => t.number === important) || selectedTrain;
          if (liveSnap) setDetailSnap(liveSnap);
        }
      }

      frameTickRef.current += 1;
      mergeOverlayLayers(trains, selectedTrain, frameTickRef.current);

      if (frameTickRef.current % 4 === 0) {
        if (selectedTrain) setDetailSnap(selectedTrain);
        // No longer force-syncLocalSim in local: store's useSimLoop owns the sim clock and recompute.
        // Map just observes latest states from getState() for visual consistency.
      }
    },
    [isLive, trainGeom, trainMeta, mergeOverlayLayers, syncLocalSim]
  );

  const scheduleRailRebuild = useCallback(() => {
    if (moveRafRef.current) return;
    moveRafRef.current = requestAnimationFrame(() => {
      moveRafRef.current = 0;
      rebuildRailCache();
      renderFrame(0);
    });
  }, [rebuildRailCache, renderFrame]);

  const renderFrameRef = useRef(renderFrame);
  const rebuildRailCacheRef = useRef(rebuildRailCache);
  const scheduleRailRebuildRef = useRef(scheduleRailRebuild);
  renderFrameRef.current = renderFrame;
  rebuildRailCacheRef.current = rebuildRailCache;
  scheduleRailRebuildRef.current = scheduleRailRebuild;

  const selectTrainRef = useRef<(number: string) => void>(() => {});
  const deselectTrainRef = useRef<() => void>(() => {});
  const selectStationRef = useRef<(code: string) => void>(() => {});

  const flyToTrain = useCallback((train: TrainSnapshot) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({
      center: train.position,
      zoom: Math.max(map.getZoom(), 9.5),
      duration: INDIA_FLY_DURATION_MS,
      essential: true,
      pitch: is3DRef.current ? 55 : 0
    });
  }, []);

  const resolveSnapshot = useCallback(
    (number: string): TrainSnapshot | null => {
      if (isLive) {
        return lastLiveTrainsRef.current.find((t) => t.number === number) ?? null;
      }
      // Local: prefer the unified store state (eased kinematics) so fly-to + detail matches roster/map
      const st = useStore.getState();
      const s = st.states.find((x) => x.number === number);
      if (s) {
        const g = st.trainGeom[number];
        const nt = st.net.trains.find((x: any) => x.number === number);
        const poly = g?.polyline ?? nt?.polyline ?? [];
        const cum = g?.cum ?? nt?.polyCumKm ?? [];
        return {
          number: s.number,
          name: s.name,
          routeStations: nt?.route ?? [],
          polyline: poly,
          polyCumKm: cum,
          position: s.position,
          bearing: s.bearing,
          distKm: s.distKm,
          speedKmh: s.speedKmh,
          status: s.status as any,
          delayMinutes: s.delayMinutes,
          estPassengers: s.estPassengers,
          nextStation: s.nextStation,
          prevStation: s.prevStation,
          etaNextSec: s.etaNextSec,
          etaFinalSec: s.etaFinalSec ?? 0,
          active: s.active
        };
      }
      const def = findTrainDefinition(number);
      return def ? computeTrainSnapshot(def, st.simSec) : null;
    },
    [isLive]
  );

  const resolveSnapshotRef = useRef(resolveSnapshot);
  resolveSnapshotRef.current = resolveSnapshot;

  const selectTrain = useCallback(
    (number: string) => {
      const snap = resolveSnapshot(number);
      if (!snap) return;
      setSelectedNumber(number);
      setDetailSnap(snap);
      selectTrainStore(number);
      // One-time fly to the train, then the RAF follow logic below will take over for continuous
      // "live walking on the map" using the real eased motion along the track.
      // We deliberately do NOT auto setTrack here (avoids double-fly + effect fights).
      // Explicit tracking (Roster, future Tracker panel) still sets trackTrain and takes precedence.
      flyToTrain(snap);
      requestAnimationFrame(() => renderFrame(0));
    },
    [flyToTrain, renderFrame, resolveSnapshot, selectTrainStore]
  );

  const deselectTrain = useCallback(() => {
    setSelectedNumber(null);
    setDetailSnap(null);
    selectTrainStore(null);
    requestAnimationFrame(() => renderFrame(0));
  }, [renderFrame, selectTrainStore]);

  // A selection made during the LOCAL-fallback warmup (e.g. 3D auto-pick racing
  // the WebSocket connect) can reference a train that doesn't exist in the live
  // corridor — its detail card would then show stale local-sim numbers forever.
  // Once live metadata is in, drop any selection the corridor doesn't know.
  useEffect(() => {
    if (!isLive || !selectedNumber) return;
    if (Object.keys(trainMeta).length === 0) return;
    if (!trainMeta[selectedNumber]) deselectTrain();
  }, [isLive, selectedNumber, trainMeta, deselectTrain]);

  const selectStation = useCallback(
    (code: string) => {
      // Station board and train card are mutually exclusive.
      setSelectedNumber(null);
      setDetailSnap(null);
      selectTrainStore(null);
      setSelectedStation(code);
      const map = mapRef.current;
      const st = net.stationMap[code];
      if (map && st) {
        map.flyTo({
          center: [st.lng, st.lat],
          zoom: Math.max(map.getZoom(), 11.5),
          duration: INDIA_FLY_DURATION_MS,
          essential: true,
          pitch: is3DRef.current ? 55 : 0
        });
      }
    },
    [net, selectTrainStore]
  );

  selectTrainRef.current = selectTrain;
  deselectTrainRef.current = deselectTrain;
  selectStationRef.current = selectStation;

  const resetView = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    deselectTrain();
    const target = isLive && corridorBounds ? corridorBounds : INDIA_BOUNDS;
    map.fitBounds(target, {
      padding: isLive && corridorBounds ? 90 : INDIA_FIT_PADDING,
      duration: INDIA_FLY_DURATION_MS,
      essential: true,
      maxZoom: 11,
      pitch: is3DRef.current ? 55 : 0
    });
  }, [deselectTrain, isLive, corridorBounds]);

  const toggle3D = useCallback(() => {
    setIs3D((v) => {
      const next = !v;
      if (next) {
        // Entering 3D: zoom right in on a live train so the real rolling-stock model is
        // big and clearly moving on the track. Prefer the current selection, else a
        // train that's actually rolling, else any active train. Selecting it also hands
        // the train to the continuous follow-cam so the view walks with it.
        const map = mapRef.current;
        const live = lastLiveTrainsRef.current;
        let focus = selectedRef.current;
        if (!focus) {
          // Prefer the fastest-moving active train so the 3D close-up clearly shows motion.
          const active = live.filter((t) => t.active);
          const pick =
            active.slice().sort((a, b) => (b.speedKmh || 0) - (a.speedKmh || 0))[0] ||
            live[0];
          focus = pick?.number ?? null;
          if (focus) selectTrainRef.current?.(focus);
        }
        if (map) {
          const snap = focus ? live.find((t) => t.number === focus) : null;
          map.flyTo({
            center: snap?.position ?? map.getCenter().toArray(),
            zoom: Math.max(map.getZoom(), 14),
            pitch: 58,
            duration: 1400,
            essential: true
          });
        }
      }
      // Re-render layers promptly so the real 3D train models (or 2D markers) swap in sync with pitch.
      requestAnimationFrame(() => renderFrameRef.current?.(0));
      return next;
    });
  }, []);

  /** Swap basemap (dark control-room <-> real satellite) and re-attach layers. */
  const toggleSatellite = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    setSatellite((sat) => {
      const next = !sat;
      map.once("style.load", () => {
        themeMapBackground(map);
        // setStyle wipes custom sources — put the OpenRailwayMap overlay back.
        applyOrmOverlay(map, ormRef.current.style, ormRef.current.opacity);
        rebuildRailCacheRef.current();
        renderFrameRef.current(0);
      });
      map.setStyle(next ? MAPBOX_SATELLITE_STYLE : MAPBOX_DARK_STYLE);
      return next;
    });
  }, []);

  /** Full-screen "monitor" mode: blow the map (with its HUD + 3D train + controls) up to
   *  fill the whole screen so the operator can watch one running train. On enter we lock
   *  onto a moving train (the current selection, else the fastest active) so there's always
   *  something to monitor. Esc or the button exits. */
  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current as
      | (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> })
      | null;
    const doc = document as Document & {
      webkitFullscreenElement?: Element;
      webkitExitFullscreen?: () => Promise<void>;
    };
    if (!root) return;
    const fsEl = document.fullscreenElement || doc.webkitFullscreenElement;
    if (!fsEl) {
      // make sure a running train is being followed before we go full screen
      if (!selectedRef.current) {
        const live = lastLiveTrainsRef.current;
        const pick =
          live
            .filter((t) => t.active)
            .slice()
            .sort((a, b) => (b.speedKmh || 0) - (a.speedKmh || 0))[0] || live[0];
        if (pick) selectTrainRef.current?.(pick.number);
      }
      (root.requestFullscreen?.() ?? root.webkitRequestFullscreen?.())?.catch?.(() => {});
    } else {
      (document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())?.catch?.(() => {});
    }
  }, []);

  // Track fullscreen state and resize the map when it changes size (mapbox needs a nudge).
  useEffect(() => {
    const doc = document as Document & { webkitFullscreenElement?: Element };
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement || doc.webkitFullscreenElement));
      // resize across a couple frames so the canvas matches the new container box
      requestAnimationFrame(() => mapRef.current?.resize());
      setTimeout(() => mapRef.current?.resize(), 250);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
    };
  }, []);

  // Keep the OpenRailwayMap overlay in sync with the picked style/opacity. The
  // satellite dep re-runs this after a basemap swap settles (belt + braces with
  // the style.load re-apply above); if the style is mid-swap the apply fails
  // soft and one 'idle' retry lands it.
  useEffect(() => {
    const map = loadedMap;
    if (!map) return;
    if (!applyOrmOverlay(map, ormStyle, ormOpacity)) {
      map.once("idle", () => {
        applyOrmOverlay(map, ormRef.current.style, ormRef.current.opacity);
      });
    }
  }, [loadedMap, satellite, ormStyle, ormOpacity]);

  useEffect(() => {
    // Leaving 3D → tilt back flat. Entering 3D is handled by toggle3D's flyTo (which
    // also sets pitch); firing a competing easeTo here would cancel that zoom-in.
    if (is3D) return;
    mapRef.current?.easeTo({ pitch: 0, duration: 800, essential: true });
  }, [is3D]);

  // The train-detail card overlays the LEFT of the map. Pad the camera's focal point
  // to the right while a train is selected so the followed train (which the RAF loop
  // re-centres each frame via setCenter) stays in the clear part of the map instead of
  // hiding behind the panel. setPadding is instant, so it never cancels a flyTo.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setPadding({ left: detailSnap ? 360 : 0, top: 0, right: 0, bottom: 0 });
  }, [detailSnap, loadedMap]);

  // Frame the live corridor as soon as the map style is ready, so the operator
  // lands on the trains — not an empty subcontinent. Polls until the map exists
  // and its style has loaded (robust to mount/connect ordering + StrictMode),
  // then fits once.
  // When the live session connects (isLive flips true / bounds arrive) AFTER the
  // map already loaded, fly to the corridor now. The load handler covers the
  // case where live was ready first.
  useEffect(() => {
    if (!loadedMap || !isLive || !corridorBounds) return;
    loadedMap.fitBounds(corridorBounds, {
      padding: 90,
      maxZoom: 11,
      duration: INDIA_FLY_DURATION_MS,
      essential: true,
      pitch: is3DRef.current ? 55 : 0
    });
  }, [loadedMap, isLive, corridorBounds]);

  useEffect(() => {
    rebuildRailCache();
    renderFrame(0);
  }, [selectedNumber, hoveredNumber, isLive, mapConflicts.length, rebuildRailCache, renderFrame]);

  useEffect(() => {
    if (!trackTrain) return;
    const snap = resolveSnapshot(trackTrain);
    if (snap) {
      setSelectedNumber(trackTrain);
      setDetailSnap(snap);
      flyToTrain(snap);
    }
  }, [trackTrain, resolveSnapshot, flyToTrain]);

  useEffect(() => {
    if (!focusConflictId) return;
    const c = mapConflicts.find((x) => x.id === focusConflictId);
    if (!c) return;
    const geom = sectionGeometry(c.location, sectionMap);
    if (!geom?.length) return;
    const mid = geom[Math.floor(geom.length / 2)];
    mapRef.current?.flyTo({
      center: mid,
      zoom: Math.max(mapRef.current?.getZoom() ?? 6, 7.5),
      duration: INDIA_FLY_DURATION_MS,
      essential: true,
      pitch: is3DRef.current ? 45 : 0
    });
  }, [focusConflictId, mapConflicts, sectionMap]);

  useEffect(() => {
    if (!mapResetSeq || mapResetSeq === lastMapResetRef.current) return;
    lastMapResetRef.current = mapResetSeq;
    resetView();
  }, [mapResetSeq, resetView]);

  useEffect(() => {
    const map = mapRef.current;
    if (!fitRoute?.length || !map) return;

    const geomEntry = Object.values(trainGeom).find((g) => {
      if (!g.polyline.length) return false;
      return fitRoute.every((code) => {
        const st = net.stationMap[code];
        if (!st) return false;
        return g.polyline.some(
          (p) => Math.abs(p[0] - st.lng) < 0.05 && Math.abs(p[1] - st.lat) < 0.05
        );
      });
    });
    const trainMatch = net.trains.find((t) => t.route.join() === fitRoute.join());
    const path: LngLat[] =
      (trainMatch && trainGeom[trainMatch.number]?.polyline) ||
      geomEntry?.polyline ||
      fitRoute
        .map((code) => net.stationMap[code])
        .filter(Boolean)
        .map((st) => [st.lng, st.lat] as LngLat);

    if (path.length === 0) {
      setFitRoute(null);
      return;
    }

    map.fitBounds(boundsFromPolyline(path), {
      padding: INDIA_FIT_PADDING,
      duration: INDIA_FLY_DURATION_MS * 1.2,
      essential: true,
      pitch: is3DRef.current ? 45 : 0
    });
    setFitRoute(null);
  }, [fitRoute, net, trainGeom, setFitRoute]);

  useEffect(() => {
    let lastWall = performance.now();
    let uiFrame = 0;

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastWall) / 1000);
      lastWall = now;

      if (isLive && playingRef.current) {
        // Live mode: backend drives authoritative simSec; client only extrapolates visuals via interpolator.
        simSecRef.current = clampSimSec(
          simSecRef.current + dt * speedRef.current,
          SIM_MIN_SEC,
          SIM_MAX_SEC
        );
      }
      // Local mode: the store (useSimLoop + simulationEngine with eased motion) is the single source of truth
      // for simSec and all TrainState. IndiaMap only renders + bumps frameTick here.

      renderFrame(dt);

      // === Continuous camera follow for tracked/selected train: the "live walking on the map" experience ===
      // Follows explicit trackTrain (Roster / Tracker) OR falls back to whatever is selected.
      // This makes clicking a train (or roster) cause the view to continuously walk with the real
      // simulation motion along the actual railway polyline (eased accel/decel, proper bearings).
      // Uses direct setCenter + light damping for a tight "the train is pulling the map" feel.
      // Releases on user gestures. Lookahead gives a driving-along-the-rails sensation.
      const followId = trackTrainRef.current || selectedRef.current;
      const mapForFollow = mapRef.current;
      if (followId && mapForFollow) {
        const nowF = performance.now();
        const timeSinceGesture = nowF - lastUserGestureRef.current;
        if (timeSinceGesture > 850 && nowF - lastFollowUpdateRef.current > 28) {
          lastFollowUpdateRef.current = nowF;
          const snap = resolveSnapshotRef.current ? resolveSnapshotRef.current(followId) : null;
          if (snap && snap.position && snap.position.length === 2) {
            // Speed-aware lookahead along the real track so the camera leads the train a little
            let targetPos: LngLat = snap.position;
            const spd = snap.speedKmh || 0;
            if (spd > 10 && snap.polyline?.length > 1 && snap.polyCumKm?.length > 1) {
              // Shrink the lookahead as we zoom in, else the lead point pushes the
              // train off the back of a tight (3D close-up) viewport.
              const zNow = mapForFollow.getZoom();
              const leadCap = zNow >= 13 ? 0.35 : zNow >= 11 ? 1.0 : 3.2;
              const leadKm = Math.min(leadCap, Math.max(0.25, spd * 0.032));
              const total = snap.polyCumKm[snap.polyCumKm.length - 1] ?? snap.distKm;
              const dTarget = Math.min(total, snap.distKm + leadKm);
              const ahead = interpAlong(snap.polyline, snap.polyCumKm, dTarget);
              targetPos = ahead.pos;
            }
            const c = mapForFollow.getCenter();
            const f = 0.13; // light damping — feels locked to the moving train without being robotic
            const nx = c.lng + (targetPos[0] - c.lng) * f;
            const ny = c.lat + (targetPos[1] - c.lat) * f;
            mapForFollow.setCenter([nx, ny]);

            // Keep the train comfortably visible while it moves on the real geometry
            const z = mapForFollow.getZoom();
            if (is3DRef.current) {
              // 3D mode = close-up "watch the train run" view. Ease the zoom in to ~14
              // every frame until we get there, so the real rolling-stock model is big
              // and clearly moving — robust even if another effect tries to zoom back out.
              if (z < 13.85) mapForFollow.setZoom(Math.min(14, z + 0.18));
            } else if (z < 7.6) {
              mapForFollow.setZoom(8.1);
            }
          }
        }
      }

      uiFrame += 1;
      if (uiFrame % 4 === 0) {
        const fresh = isLive ? storeSimSec : useStore.getState().simSec;
        setSimSecDisplay(fresh);
        if (!isLive) simSecRef.current = fresh; // keep ref roughly current for any legacy reads

        // Live "now following" HUD: the tracked/selected train's number + speed, refreshed
        // a few times a second straight off the same snapshot that drives the map.
        const fid = trackTrainRef.current || selectedRef.current;
        if (fid && resolveSnapshotRef.current) {
          const s = resolveSnapshotRef.current(fid);
          if (s) {
            setFollowHud({
              number: s.number,
              name: (s as { name?: string }).name,
              speed: Math.round(s.speedKmh || 0),
              status: s.status as string
            });
          } else {
            setFollowHud(null);
          }
        } else {
          setFollowHud(null);
        }
      }

      animRafRef.current = requestAnimationFrame(tick);
    };

    animRafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRafRef.current);
  }, [renderFrame, isLive, storeSimSec]);

  const handlePlayPause = useCallback(() => {
    if (isLive) {
      setPlayingStore(!storePlaying);
      return;
    }
    // Local: delegate to store so useSimLoop is the single driver (consistent with roster/AI/conflicts)
    setPlayingStore(!storePlaying);
    // also keep ref in sync for any live-only bits
    playingRef.current = !playingRef.current;
  }, [isLive, setPlayingStore, storePlaying]);

  const handleSpeed = useCallback(
    (s: SimSpeedPreset) => {
      if (isLive) {
        setSpeedStore(s);
        return;
      }
      setSpeedStore(s);
      speedRef.current = s;
    },
    [isLive, setSpeedStore]
  );

  const handleScrub = useCallback(
    (sec: number) => {
      if (isLive) {
        scrubStore(sec);
        return;
      }
      // Delegate to store (single sim time source now)
      scrubStore(sec);
      // keep local display ref roughly in sync immediately
      const clamped = clampSimSec(sec, SIM_MIN_SEC, SIM_MAX_SEC);
      simSecRef.current = clamped;
      setSimSecDisplay(clamped);
      renderFrame(0);
    },
    [isLive, scrubStore, renderFrame]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !token || mapRef.current) return;

    setLoadedMap(null);
    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: el,
      style: MAPBOX_DARK_STYLE,
      center: INDIA_BOUNDS[0],
      zoom: 3,
      pitch: 0,
      attributionControl: false,
      fadeDuration: 0,
      performanceMetricsCollection: false
    });

    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    const overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
      // forgiving hit area so small station dots + trains are easy to click
      pickingRadius: 16,
      onClick: (info: PickingInfo) => {
        const picked = pickedTrainNumber(info);
        if (picked) {
          selectTrainRef.current(picked);
          return true;
        }
        if (isStationPick(info)) {
          selectStationRef.current(info.object.code);
          return true;
        }
        deselectTrainRef.current();
        setSelectedStation(null);
        return false;
      },
      onHover: (info: PickingInfo) => {
        const next = pickedTrainNumber(info);
        if (hoveredRef.current !== next) {
          hoveredRef.current = next;
          setHoveredNumber(next);
        }
        map.getCanvas().style.cursor =
          isTrainPick(info) || isStationPick(info) ? "pointer" : "";
      }
    });

    mapRef.current = map;
    overlayRef.current = overlay;

    // Attach the deck overlay + frame the view once the style is ready. The
    // 'load' event can be missed (cached style / fast navigation), which would
    // leave the overlay unattached → no trains, no track. So we ALSO poll
    // isStyleLoaded() and run the (idempotent) setup whichever fires first.
    let ready = false;
    function onMapReady() {
      if (ready || mapRef.current !== map) return;
      ready = true;
      window.clearTimeout(readyTimer);
      themeMapBackground(map);
      map.addControl(overlay);
      frameInitialViewRef.current(map);
      rebuildRailCacheRef.current();
      renderFrameRef.current(0);
      setLoadedMap(map);
    }
    // Trigger on whichever fires first; the timeout guarantees setup even when
    // 'load'/isStyleLoaded misbehave with interleaved deck overlays.
    const readyTimer = window.setTimeout(onMapReady, 900);
    map.on("load", onMapReady);
    map.on("idle", onMapReady);

    map.on("move", () => scheduleRailRebuildRef.current());
    map.on("zoom", () => scheduleRailRebuildRef.current());
    map.on("moveend", () => {
      rebuildRailCacheRef.current();
      renderFrameRef.current(0);
    });

    // User gestures temporarily pause the automatic camera follow so the judge can
    // freely explore, then it gracefully resumes following the selected train.
    const markGesture = () => { lastUserGestureRef.current = performance.now(); };
    map.on("dragstart", markGesture);
    map.on("zoomstart", markGesture);
    map.on("rotatestart", markGesture);
    map.on("pitchstart", markGesture);
    map.on("touchstart", markGesture);

    map.on("error", (ev) => {
      const err = (ev as mapboxgl.ErrorEvent & { error?: Error }).error ?? ev;
      if (isAbortError(err) || isBenignMapNetworkError(err)) return;
      console.warn("[Mapbox]", err);
    });

    // Resize the map whenever its CONTAINER box changes — not just the window.
    // This is what keeps full-screen correct: entering element-fullscreen does NOT
    // fire a window 'resize' (so Mapbox's built-in trackResize never runs), leaving the
    // canvas at its old small size while displayed huge. The basemap and the deck.gl
    // train/track layers then drift apart, so on Mumbai's thin coastal strip the trains
    // appeared to slide off into the sea / float in the air. A ResizeObserver fixes every
    // size change (fullscreen, side panels, window) with one mechanism.
    let resizeRaf = 0;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => mapRef.current?.resize());
    });
    resizeObserver.observe(el);

    return () => {
      window.clearTimeout(readyTimer);
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeObserver.disconnect();
      if (moveRafRef.current) cancelAnimationFrame(moveRafRef.current);
      if (animRafRef.current) cancelAnimationFrame(animRafRef.current);
      const ov = overlayRef.current;
      const m = mapRef.current;
      overlayRef.current = null;
      mapRef.current = null;
      setLoadedMap(null);
      if (m) {
        requestAnimationFrame(() => disposeMapboxMap(m, ov));
      }
    };
  }, [token]);

  const searchDefs: TrainDefinition[] = useMemo(() => {
    if (isLive) {
      return Object.entries(trainMeta).map(([number, m]) => {
        const def = findTrainDefinition(number);
        return (
          def ?? {
            number,
            name: m.name,
            routeStations: m.route,
            polyline: trainGeom[number]?.polyline ?? [],
            polyCumKm: trainGeom[number]?.cum ?? [],
            routeCumKm: [],
            stops: [],
            delaySec: 0,
            baseStatus: "running" as const,
            estPassengers: 0
          }
        );
      });
    }
    return loadTrainDefinitions();
  }, [isLive, trainMeta, trainGeom]);

  if (!token) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-base text-muted text-sm px-6 text-center">
        <p>Mapbox token missing.</p>
        <p className="text-xs font-mono text-cyan/80">
          Set NEXT_PUBLIC_MAPBOX_TOKEN in frontend/.env.local
        </p>
      </div>
    );
  }

  const clockSimSec = isLive ? storeSimSec : simSecDisplay;
  const clockPlaying = isLive ? storePlaying : playing;
  const clockSpeed = isLive ? (storeSpeed as SimSpeedPreset) : speed;

  return (
    <div ref={rootRef} className="absolute inset-0 bg-base">
      <div ref={containerRef} className="absolute inset-0 india-map" aria-label="India map" />
      <button
        type="button"
        onClick={resetView}
        className="absolute top-4 left-4 z-10 panel bg-panel/95 backdrop-blur px-3 py-1.5 text-xs font-semibold text-cyan border border-cyan/40 hover:bg-cyan/10 transition-colors"
      >
        Reset view
      </button>
      <button
        type="button"
        onClick={toggle3D}
        className={`absolute top-14 left-4 z-10 panel bg-panel/95 backdrop-blur px-3 py-1.5 text-xs font-semibold border transition-colors ${
          is3D
            ? "text-cyan border-cyan/60 bg-cyan/10"
            : "text-muted border-white/20 hover:border-cyan/40 hover:text-cyan"
        }`}
      >
        3D
      </button>
      <button
        type="button"
        onClick={toggleSatellite}
        title="Toggle real satellite imagery"
        className={`absolute top-[88px] left-4 z-10 panel bg-panel/95 backdrop-blur px-3 py-1.5 text-xs font-semibold border transition-colors ${
          satellite
            ? "text-cyan border-cyan/60 bg-cyan/10"
            : "text-muted border-white/20 hover:border-cyan/40 hover:text-cyan"
        }`}
      >
        SAT
      </button>
      <button
        type="button"
        onClick={toggleFullscreen}
        title={isFullscreen ? "Exit full screen (Esc)" : "Full-screen monitor of the running train"}
        className={`absolute top-[122px] left-4 z-10 panel bg-panel/95 backdrop-blur px-3 py-1.5 text-xs font-semibold border transition-colors ${
          isFullscreen
            ? "text-cyan border-cyan/60 bg-cyan/10"
            : "text-muted border-white/20 hover:border-cyan/40 hover:text-cyan"
        }`}
      >
        {isFullscreen ? "⤡ Exit" : "⛶ Full"}
      </button>
      <RailInfraControl />
      <TrainSearch
        trains={searchDefs}
        onSelect={(t) => selectTrain(t.number)}
      />
      <MapLegend />
      <DemoCaption />
      {followHud && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10 panel bg-panel/95 backdrop-blur px-3.5 py-2 flex items-center gap-2.5 text-xs border border-border shadow-lg pointer-events-none">
          <span className="text-[10px] uppercase tracking-widest text-muted">Following</span>
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{
              backgroundColor: HUD_STATUS_COLOR[followHud.status] ?? "#37D99A",
              animation: followHud.speed > 2 ? "pulseRisk 1.1s ease-in-out infinite" : undefined
            }}
          />
          <span className="font-mono font-bold text-text tracking-wider">{followHud.number}</span>
          {followHud.name && (
            <span className="text-muted max-w-[180px] truncate">{followHud.name}</span>
          )}
          <span className="font-mono text-cyan tabular-nums">
            {followHud.speed > 2 ? `${followHud.speed} km/h` : "stopped"}
          </span>
        </div>
      )}
      {selectedNumber && detailSnap && (
        <TrainDetailPanel
          trainNumber={selectedNumber}
          simSec={clockSimSec}
          snapshot={detailSnap}
          onClose={deselectTrain}
        />
      )}
      {selectedStation && (
        <StationView code={selectedStation} onClose={() => setSelectedStation(null)} />
      )}
      <SimClockBar
        simSec={clockSimSec}
        playing={clockPlaying}
        speed={clockSpeed}
        simMin={isLive ? windowStart : SIM_MIN_SEC}
        simMax={isLive ? windowEnd : SIM_MAX_SEC}
        live={isLive}
        onPlayPause={handlePlayPause}
        onSpeed={handleSpeed}
        onScrub={handleScrub}
      />
    </div>
  );
}
