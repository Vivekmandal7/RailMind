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
  isTrainPick
} from "@/lib/mapLayers";
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
import { DemoCaption } from "@/components/DemoMode";
import { isBenignMapNetworkError } from "@/lib/mapNetworkErrors";
import "mapbox-gl/dist/mapbox-gl.css";

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
  const lastMapResetRef = useRef(0);

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
            frameTick
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
        const simSec = simSecRef.current;
        const inView = (snap: TrainSnapshot) =>
          pointInBounds(snap.position[0], snap.position[1], bounds);
        const routeInView = (def: TrainDefinition) => {
          const pl = def.polyline;
          if (pl.length === 0) return false;
          const step = Math.max(1, Math.floor(pl.length / 8));
          for (let i = 0; i < pl.length; i += step) {
            if (pointInBounds(pl[i][0], pl[i][1], bounds)) return true;
          }
          return false;
        };
        trains = computeVisibleSnapshots(simSec, inView, selected, routeInView);
        selectedTrain = selected
          ? trains.find((t) => t.number === selected) ??
            (() => {
              const def = findTrainDefinition(selected);
              return def ? computeTrainSnapshot(def, simSec) : null;
            })()
          : null;
      }

      frameTickRef.current += 1;
      mergeOverlayLayers(trains, selectedTrain, frameTickRef.current);

      if (frameTickRef.current % 4 === 0) {
        if (selectedTrain) setDetailSnap(selectedTrain);
        if (!isLive) {
          syncLocalSim(simSecRef.current);
        }
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
      const def = findTrainDefinition(number);
      return def ? computeTrainSnapshot(def, simSecRef.current) : null;
    },
    [isLive]
  );

  const selectTrain = useCallback(
    (number: string) => {
      const snap = resolveSnapshot(number);
      if (!snap) return;
      setSelectedNumber(number);
      setDetailSnap(snap);
      selectTrainStore(number);
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

  const toggle3D = useCallback(() => setIs3D((v) => !v), []);

  /** Swap basemap (dark control-room <-> real satellite) and re-attach layers. */
  const toggleSatellite = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    setSatellite((sat) => {
      const next = !sat;
      map.once("style.load", () => {
        rebuildRailCacheRef.current();
        renderFrameRef.current(0);
      });
      map.setStyle(next ? MAPBOX_SATELLITE_STYLE : MAPBOX_DARK_STYLE);
      return next;
    });
  }, []);

  useEffect(() => {
    mapRef.current?.easeTo({ pitch: is3D ? 55 : 0, duration: 800, essential: true });
  }, [is3D]);

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

      if (!isLive && playingRef.current) {
        simSecRef.current = clampSimSec(
          simSecRef.current + dt * speedRef.current,
          SIM_MIN_SEC,
          SIM_MAX_SEC
        );
      }

      renderFrame(dt);

      uiFrame += 1;
      if (uiFrame % 4 === 0) {
        setSimSecDisplay(isLive ? storeSimSec : simSecRef.current);
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
    setPlaying((p) => {
      playingRef.current = !p;
      return !p;
    });
  }, [isLive, setPlayingStore, storePlaying]);

  const handleSpeed = useCallback(
    (s: SimSpeedPreset) => {
      if (isLive) {
        setSpeedStore(s);
        return;
      }
      setSpeed(s);
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
      simSecRef.current = clampSimSec(sec, SIM_MIN_SEC, SIM_MAX_SEC);
      setSimSecDisplay(simSecRef.current);
      syncLocalSim(simSecRef.current);
      renderFrame(0);
    },
    [isLive, scrubStore, renderFrame, syncLocalSim]
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
      pickingRadius: 8,
      onClick: (info: PickingInfo) => {
        if (isTrainPick(info)) {
          selectTrainRef.current(info.object.number);
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
        const next = isTrainPick(info) ? info.object.number : null;
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

    map.on("error", (ev) => {
      const err = (ev as mapboxgl.ErrorEvent & { error?: Error }).error ?? ev;
      if (isAbortError(err) || isBenignMapNetworkError(err)) return;
      console.warn("[Mapbox]", err);
    });

    return () => {
      window.clearTimeout(readyTimer);
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
    <>
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
      <TrainSearch
        trains={searchDefs}
        onSelect={(t) => selectTrain(t.number)}
      />
      <MapLegend />
      <DemoCaption />
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
    </>
  );
}
