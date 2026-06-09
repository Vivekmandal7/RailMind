"use client";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import DeckGL from "@deck.gl/react";
import { MapView, FlyToInterpolator } from "@deck.gl/core";
import { PathLayer, ScatterplotLayer, TextLayer, IconLayer } from "@deck.gl/layers";
import { useStore } from "@/store/useStore";
import { interpAlong } from "@/lib/geo";
import { networkViewport } from "@/lib/dataLoader";
import MapBasemap from "@/components/MapBasemap";
import type { Conflict, LngLat, Section, TrainState } from "@/lib/types";

const STATUS_RGB: Record<string, [number, number, number]> = {
  running: [55, 217, 154],
  scheduled: [120, 130, 145],
  delayed: [245, 176, 39],
  held: [255, 92, 92],
  conflict: [255, 92, 92],
  arrived: [90, 100, 115]
};

const MAJOR_STATIONS = new Set([
  "NDLS", "CSMT", "HWH", "MAS", "SBC", "BZA", "NGP", "BPL", "KOTA", "PUNE", "HYB", "SC",
  "BSP", "TATA", "VSKP", "BBS", "DR", "LKO", "AGC", "ET", "BPQ", "RTM", "BRC", "ST", "BSR",
  "RU", "GTL", "WADI", "SUR", "JTJ", "SA", "CBE", "ERS", "TVC", "NJP", "GHY", "KYN", "IGP"
]);

const TRAIN_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="84" viewBox="0 0 40 84">
    <path d="M20 2 C30 2 35 11 35 24 L35 66 C35 78 29 82 20 82 C11 82 5 78 5 66 L5 24 C5 11 10 2 20 2 Z" fill="white"/>
    <rect x="11" y="9" width="18" height="7" rx="3" fill="white" opacity="0.55"/>
  </svg>`
);
const TRAIN_ICON = {
  url: `data:image/svg+xml;charset=utf-8,${TRAIN_SVG}`,
  width: 40,
  height: 84,
  anchorX: 20,
  anchorY: 42,
  mask: true
};

interface Anim {
  dist: number;
  bearing: number;
  initialized: boolean;
}

function sectionMid(sec: Section): LngLat {
  const g = sec.geometry;
  return g[Math.floor(g.length / 2)];
}

function canonical(id: string): string {
  const [a, b] = id.split("-");
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function lerpAngle(a: number, b: number, t: number): number {
  const d = ((b - a + 540) % 360) - 180;
  return a + d * t;
}

function viewportBounds(vs: { longitude: number; latitude: number; zoom: number }, pad = 0.4) {
  const lngSpan = 360 / Math.pow(2, vs.zoom);
  const latSpan = 170 / Math.pow(2, vs.zoom);
  return {
    minLng: vs.longitude - lngSpan * (0.5 + pad),
    maxLng: vs.longitude + lngSpan * (0.5 + pad),
    minLat: vs.latitude - latSpan * (0.5 + pad),
    maxLat: vs.latitude + latSpan * (0.5 + pad)
  };
}

function inBounds(p: LngLat, b: ReturnType<typeof viewportBounds>) {
  return p[0] >= b.minLng && p[0] <= b.maxLng && p[1] >= b.minLat && p[1] <= b.maxLat;
}

function sectionInBounds(s: Section, b: ReturnType<typeof viewportBounds>) {
  return s.geometry.some((p) => inBounds(p, b));
}

function boundsFromPolyline(path: LngLat[]) {
  const lats = path.map((c) => c[1]);
  const lngs = path.map((c) => c[0]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latDiff = Math.max(0.12, maxLat - minLat);
  const lngDiff = Math.max(0.12, maxLng - minLng);
  const zoomLat = Math.log2(170 / (latDiff * 1.4));
  const zoomLng = Math.log2(360 / (lngDiff * 1.4));
  return {
    longitude: (minLng + maxLng) / 2,
    latitude: (minLat + maxLat) / 2,
    zoom: Math.min(Math.max(Math.min(zoomLat, zoomLng), 5), 14)
  };
}

export default function NetworkMap() {
  const net = useStore((s) => s.net);
  const states = useStore((s) => s.states);
  const conflicts = useStore((s) => s.conflicts);
  const cascade = useStore((s) => s.cascade);
  const selectedTrain = useStore((s) => s.selectedTrain);
  const trackTrain = useStore((s) => s.trackTrain);
  const trainGeom = useStore((s) => s.trainGeom);
  const passengerLayer = useStore((s) => s.passengerLayer);
  const fitRoute = useStore((s) => s.fitRoute);
  const setTrack = useStore((s) => s.setTrack);
  const showCascade = useStore((s) => s.showCascade);
  const clearCascade = useStore((s) => s.clearCascade);
  const setFitRoute = useStore((s) => s.setFitRoute);

  const initialVp = useMemo(() => networkViewport(net), [net]);
  const [viewState, setViewState] = useState({
    ...initialVp,
    pitch: 0,
    bearing: 0,
    transitionDuration: 0
  });
  const [frameTick, setFrameTick] = useState(0);
  const [hoveredTrain, setHoveredTrain] = useState<string | null>(null);

  const animRef = useRef<Record<string, Anim>>({});
  const trailRef = useRef<Record<string, LngLat[]>>({});
  const renderedRef = useRef<
    Record<string, { pos: LngLat; bearing: number; rgb: [number, number, number] }>
  >({});
  const rgbRef = useRef<Record<string, [number, number, number]>>({});
  const frameCount = useRef(0);
  const followRef = useRef<string | null>(null);
  const flyPendingRef = useRef(false);
  const lastFollowUpdate = useRef(0);

  // Re-center when the network dataset changes (live hydration).
  useEffect(() => {
    const vp = networkViewport(net);
    setViewState((v) => ({
      ...v,
      longitude: vp.longitude,
      latitude: vp.latitude,
      zoom: vp.zoom,
      transitionDuration: 0
    }));
  }, [net.stations.length, net.sections.length]);

  const handleTrainClick = useCallback(
    (train: TrainState) => {
      if (trackTrain === train.number) {
        setTrack(null);
        clearCascade();
        followRef.current = null;
        return;
      }
      setTrack(train.number);
      if (train.delayMinutes > 0) showCascade(train.number);
    },
    [trackTrain, setTrack, clearCascade, showCascade]
  );

  const handleMapClick = useCallback(
    (info: any) => {
      if (info.layer?.id === "trains" && info.object) {
        handleTrainClick(info.object as TrainState);
        return;
      }
      setTrack(null);
      clearCascade();
      followRef.current = null;
    },
    [handleTrainClick, setTrack, clearCascade]
  );

  useEffect(() => {
    let raf = 0;
    let lastT = performance.now();
    const loop = () => {
      const now = performance.now();
      const dtReal = (now - lastT) / 1000;
      lastT = now;
      stepInterpolation(dtReal, now);
      frameCount.current++;
      setFrameTick((n) => n + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stepInterpolation(dtReal: number, now: number) {
    const st = useStore.getState();
    const geomMap = st.trainGeom;
    const live = st.mode === "live";
    const snapAgeSec = live ? Math.min(2, (now - st.lastSnapshotAt) / 1000) : 0;

    for (const t of st.states) {
      const geom = geomMap[t.number];
      const targetRgb = STATUS_RGB[t.status] ?? [200, 200, 200];

      if (!geom) {
        if (t.active && t.position?.length === 2) {
          const cur = rgbRef.current[t.number] ?? targetRgb;
          rgbRef.current[t.number] = targetRgb;
          renderedRef.current[t.number] = {
            pos: t.position,
            bearing: t.bearing,
            rgb: cur
          };
        }
        continue;
      }
      const total = geom.cum[geom.cum.length - 1];
      if (!t.active) {
        delete animRef.current[t.number];
        trailRef.current[t.number] = [];
        continue;
      }
      const target = Math.max(
        0,
        Math.min(total, t.distKm + (live ? (t.speedKmh * snapAgeSec) / 3600 : 0))
      );
      let a = animRef.current[t.number];
      if (!a || !a.initialized) {
        a = { dist: target, bearing: t.bearing, initialized: true };
        animRef.current[t.number] = a;
      }
      const k = Math.min(1, dtReal * (live ? 6 : 12));
      a.dist += (target - a.dist) * k;

      const { pos, bearing } = interpAlong(geom.polyline, geom.cum, a.dist);
      a.bearing = lerpAngle(a.bearing, bearing, Math.min(1, dtReal * 8));

      const cur = rgbRef.current[t.number] ?? targetRgb;
      const ck = Math.min(1, dtReal * 4);
      const rgb: [number, number, number] = [
        cur[0] + (targetRgb[0] - cur[0]) * ck,
        cur[1] + (targetRgb[1] - cur[1]) * ck,
        cur[2] + (targetRgb[2] - cur[2]) * ck
      ];
      rgbRef.current[t.number] = rgb;
      renderedRef.current[t.number] = { pos, bearing: a.bearing, rgb };

      if (frameCount.current % 4 === 0 && t.speedKmh > 1) {
        const trail = (trailRef.current[t.number] ||= []);
        trail.push(pos);
        if (trail.length > 18) trail.shift();
      }
    }

    // Smooth camera follow for tracked train (after initial flyTo).
    const follow = st.trackTrain;
    if (follow && followRef.current === follow && !flyPendingRef.current) {
      const r = renderedRef.current[follow];
      if (r && now - lastFollowUpdate.current > 32) {
        lastFollowUpdate.current = now;
        setViewState((v) => {
          const dx = Math.abs(v.longitude - r.pos[0]);
          const dy = Math.abs(v.latitude - r.pos[1]);
          if (dx < 0.00002 && dy < 0.00002) return v;
          return {
            ...v,
            longitude: r.pos[0],
            latitude: r.pos[1],
            zoom: Math.max(v.zoom, 10.5),
            transitionDuration: 0
          };
        });
      }
    }
  }

  // Fly to + follow when a train is selected from map, roster, tracker, or alerts.
  useEffect(() => {
    if (!trackTrain) {
      followRef.current = null;
      return;
    }
    followRef.current = trackTrain;
    flyPendingRef.current = true;
    const geom = trainGeom[trackTrain];
    const st = useStore.getState().states.find((s) => s.number === trackTrain);
    const pos = renderedRef.current[trackTrain]?.pos ?? st?.position;
    if (!pos) return;
    const fit = geom?.polyline?.length ? boundsFromPolyline(geom.polyline) : null;
    setViewState((v) => ({
      ...v,
      longitude: fit?.longitude ?? pos[0],
      latitude: fit?.latitude ?? pos[1],
      zoom: Math.max(v.zoom, fit?.zoom ?? 11),
      transitionDuration: 900,
      transitionInterpolator: new FlyToInterpolator({ speed: 1.2 })
    }));
  }, [trackTrain, trainGeom]);

  useEffect(() => {
    if (!flyPendingRef.current) return;
    const t = setTimeout(() => {
      flyPendingRef.current = false;
    }, 950);
    return () => clearTimeout(t);
  }, [trackTrain]);

  // Zoom-to-fit route when requested by tracker.
  useEffect(() => {
    if (!fitRoute || fitRoute.length === 0) return;
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
    const path =
      (trainMatch && trainGeom[trainMatch.number]?.polyline) ||
      geomEntry?.polyline ||
      fitRoute
        .map((code) => net.stationMap[code])
        .filter(Boolean)
        .map((st) => [st.lng, st.lat] as LngLat);

    if (path.length === 0) return;
    const fit = boundsFromPolyline(path);
    setViewState((v) => ({
      ...v,
      ...fit,
      transitionDuration: 900,
      transitionInterpolator: new FlyToInterpolator({ speed: 1.2 })
    }));
    setFitRoute(null);
  }, [fitRoute, net, trainGeom, setFitRoute]);

  const pulse = (performance.now() % 1200) / 1200;

  const cascadeSections = useMemo(() => new Set(cascade?.sections ?? []), [cascade]);
  const cascadeTrains = useMemo(() => new Set(cascade?.trains ?? []), [cascade]);

  const paxBySection = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of states) {
      if (t.active && t.currentSection) {
        const k = canonical(t.currentSection);
        m[k] = (m[k] ?? 0) + t.estPassengers;
      }
    }
    return m;
  }, [states]);

  const active = states.filter((t) => t.active);
  const bounds = viewportBounds(viewState);

  // Tracks/stations: viewport cull for performance. Trains: always draw all active.
  const vizSections = useMemo(
    () => net.sections.filter((s) => sectionInBounds(s, bounds)),
    [net.sections, bounds.minLng, bounds.maxLng, bounds.minLat, bounds.maxLat]
  );
  const vizStations = useMemo(
    () => net.stations.filter((st) => inBounds([st.lng, st.lat], bounds)),
    [net.stations, bounds.minLng, bounds.maxLng, bounds.minLat, bounds.maxLat]
  );

  const zoom = viewState.zoom;
  const showAllLabels = zoom >= 8;
  const showMajorLabels = zoom >= 5.5;
  const stationLabelData = useMemo(
    () =>
      vizStations.filter(
        (s) => showAllLabels || (showMajorLabels && MAJOR_STATIONS.has(s.code))
      ),
    [vizStations, showAllLabels, showMajorLabels]
  );

  const labelTrains = useMemo(
    () =>
      active.filter(
        (t) =>
          t.number === selectedTrain ||
          t.number === hoveredTrain ||
          showAllLabels
      ),
    [active, selectedTrain, hoveredTrain, showAllLabels]
  );

  const selectedRoutePath = selectedTrain ? trainGeom[selectedTrain]?.polyline : null;

  const layers = useMemo(() => {
    const ls: any[] = [];

    // Real rail network tracks (section LineStrings from GeoJSON).
    ls.push(
      new PathLayer<Section>({
        id: "tracks",
        data: vizSections,
        getPath: (d) => d.geometry,
        getColor: (d) => {
          const k = canonical(d.id);
          if (passengerLayer) {
            const pax = paxBySection[k] ?? 0;
            const t = Math.min(1, pax / 4000);
            return [
              Math.round(40 + t * 215),
              Math.round(120 - t * 80),
              Math.round(150 - t * 110),
              210
            ];
          }
          if (d.line === "single") return [130, 100, 45, 220];
          return [58, 68, 82, 235];
        },
        getWidth: (d) => (d.line === "single" ? 3.8 : 3.0),
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true
      })
    );

    // Selected train full route — bright cyan over dim network.
    if (selectedRoutePath && selectedRoutePath.length > 1) {
      ls.push(
        new PathLayer({
          id: "selected-route",
          data: [{ path: selectedRoutePath }],
          getPath: (d: { path: LngLat[] }) => d.path,
          getColor: [58, 208, 222, 255],
          getWidth: 6,
          widthUnits: "pixels",
          capRounded: true,
          jointRounded: true
        })
      );
    }

    if (cascadeSections.size) {
      ls.push(
        new PathLayer<Section>({
          id: "cascade-path",
          data: vizSections.filter((s) => cascadeSections.has(canonical(s.id))),
          getPath: (d) => d.geometry,
          getColor: [58, 208, 222, Math.round(120 + pulse * 120)],
          getWidth: 5,
          widthUnits: "pixels",
          capRounded: true,
          jointRounded: true,
          updateTriggers: { getColor: pulse }
        })
      );
    }

    ls.push(
      new ScatterplotLayer({
        id: "stations",
        data: vizStations,
        getPosition: (d: { lng: number; lat: number }) => [d.lng, d.lat],
        getRadius: 3,
        radiusUnits: "pixels",
        getFillColor: [200, 210, 222, 230],
        getLineColor: [11, 13, 17, 255],
        lineWidthMinPixels: 1,
        stroked: true
      })
    );
    ls.push(
      new TextLayer({
        id: "station-labels",
        data: stationLabelData,
        getPosition: (d: { lng: number; lat: number }) => [d.lng, d.lat],
        getText: (d: { code: string }) => d.code,
        getSize: 10,
        getColor: [153, 161, 173, 230],
        getPixelOffset: [0, 11],
        fontFamily: "monospace",
        characterSet: "auto",
        getTextAnchor: "middle",
        getAlignmentBaseline: "top",
        billboard: true
      })
    );

    const cz = conflicts.map((c) => ({ c, pos: conflictPos(net, c) })).filter((x) => x.pos);
    ls.push(
      new ScatterplotLayer({
        id: "conflict-glow",
        data: cz,
        getPosition: (d: { pos: LngLat }) => d.pos,
        getRadius: () => 14 + pulse * 16,
        radiusUnits: "pixels",
        getFillColor: (d: { c: Conflict }) =>
          d.c.severity === "critical"
            ? [255, 92, 92, Math.round(90 - pulse * 70)]
            : [245, 176, 39, Math.round(80 - pulse * 60)],
        updateTriggers: { getRadius: pulse, getFillColor: pulse }
      })
    );

    const trailData = active
      .map((t) => ({
        number: t.number,
        path: trailRef.current[t.number] ?? [],
        rgb: rgbRef.current[t.number]
      }))
      .filter((d) => d.path.length > 1);
    ls.push(
      new PathLayer({
        id: "train-trails",
        data: trailData,
        getPath: (d: { path: LngLat[] }) => d.path,
        getColor: (d: { rgb?: [number, number, number] }) => {
          const c = d.rgb ?? [120, 200, 220];
          return [Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), 70];
        },
        getWidth: 2.2,
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
        updateTriggers: { getPath: frameTick, getColor: frameTick }
      })
    );

    ls.push(
      new ScatterplotLayer({
        id: "train-glow",
        data: active,
        getPosition: (d: TrainState) => renderedRef.current[d.number]?.pos ?? d.position,
        getRadius: (d: TrainState) => (d.number === selectedTrain ? 17 : 12),
        radiusUnits: "pixels",
        parameters: { depthTest: false },
        getFillColor: (d: TrainState) => {
          const c = rgbRef.current[d.number] ?? STATUS_RGB[d.status] ?? [200, 200, 200];
          return [Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), 55];
        },
        updateTriggers: {
          getPosition: frameTick,
          getRadius: selectedTrain,
          getFillColor: frameTick
        }
      })
    );

    ls.push(
      new ScatterplotLayer({
        id: "cascade-ring",
        data: active.filter((t) => cascadeTrains.has(t.number)),
        getPosition: (d: TrainState) => renderedRef.current[d.number]?.pos ?? d.position,
        getRadius: 14 + pulse * 6,
        radiusUnits: "pixels",
        stroked: true,
        filled: false,
        getLineColor: [58, 208, 222, 230],
        lineWidthMinPixels: 2,
        parameters: { depthTest: false },
        updateTriggers: { getPosition: frameTick, getRadius: pulse }
      })
    );

    ls.push(
      new IconLayer({
        id: "trains",
        data: active,
        getIcon: () => TRAIN_ICON as never,
        getPosition: (d: TrainState) => renderedRef.current[d.number]?.pos ?? d.position,
        getAngle: (d: TrainState) => -(renderedRef.current[d.number]?.bearing ?? d.bearing),
        getSize: (d: TrainState) => (d.number === selectedTrain ? 26 : 21),
        sizeUnits: "pixels",
        billboard: true,
        parameters: { depthTest: false },
        getColor: (d: TrainState) => {
          const c = rgbRef.current[d.number] ?? STATUS_RGB[d.status] ?? [220, 220, 220];
          return [Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), 255];
        },
        pickable: true,
        onHover: (info: { object?: TrainState }) => {
          setHoveredTrain(info.object?.number ?? null);
        },
        updateTriggers: {
          getPosition: frameTick,
          getAngle: frameTick,
          getColor: frameTick,
          getSize: selectedTrain
        }
      })
    );

    ls.push(
      new TextLayer({
        id: "train-labels",
        data: labelTrains,
        getPosition: (d: TrainState) => renderedRef.current[d.number]?.pos ?? d.position,
        getText: (d: TrainState) => d.number,
        getSize: (d: TrainState) => (d.number === selectedTrain ? 12 : 11),
        getColor: (d: TrainState) => {
          const c = rgbRef.current[d.number] ?? STATUS_RGB[d.status] ?? [231, 234, 240];
          return [Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), 255];
        },
        getPixelOffset: [0, -17],
        fontFamily: "monospace",
        fontWeight: 700,
        characterSet: "auto",
        getTextAnchor: "middle",
        getAlignmentBaseline: "bottom",
        billboard: true,
        updateTriggers: {
          getPosition: frameTick,
          getColor: frameTick,
          getSize: selectedTrain
        }
      })
    );

    return ls;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    net,
    vizSections,
    vizStations,
    active,
    labelTrains,
    stationLabelData,
    conflicts,
    pulse,
    selectedTrain,
    selectedRoutePath,
    cascadeSections,
    cascadeTrains,
    passengerLayer,
    paxBySection,
    frameTick
  ]);

  return (
    <div className="absolute inset-0 network-map">
      <DeckGL
        views={new MapView({ repeat: false })}
        viewState={viewState}
        onViewStateChange={(e: any) => {
          const i = e.interactionState;
          if (i?.isDragging || i?.isZooming || i?.isPanning) {
            followRef.current = null;
            flyPendingRef.current = false;
          }
          setViewState(e.viewState);
        }}
        controller={true}
        layers={layers}
        onClick={handleMapClick}
        getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
      >
        <MapBasemap />
      </DeckGL>
    </div>
  );
}

function conflictPos(net: { sectionMap: Record<string, Section>; stationMap: Record<string, { lng: number; lat: number }> }, c: Conflict): LngLat | null {
  const sec = net.sectionMap[c.location];
  if (sec) return sectionMid(sec);
  const sta = net.stationMap[c.location];
  if (sta) return [sta.lng, sta.lat];
  return null;
}
