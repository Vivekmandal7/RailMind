"use client";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import DeckGL from "@deck.gl/react";
import { MapView } from "@deck.gl/core";
import { PathLayer, ScatterplotLayer, TextLayer, IconLayer } from "@deck.gl/layers";
import { Map } from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import { useStore } from "@/store/useStore";
import { interpAlong } from "@/lib/geo";
import type { Conflict, LngLat, Section, TrainState } from "@/lib/types";

const STATUS_RGB: Record<string, [number, number, number]> = {
  running: [55, 217, 154],
  scheduled: [120, 130, 145],
  delayed: [245, 176, 39],
  held: [255, 92, 92],
  conflict: [255, 92, 92],
  arrived: [90, 100, 115]
};

const DARK_STYLE = {
  version: 8,
  sources: {
    "carto-dark": {
      type: "raster" as const,
      tiles: ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }
  },
  layers: [
    {
      id: "carto-dark",
      type: "raster" as const,
      source: "carto-dark",
      minzoom: 0,
      maxzoom: 22
    }
  ]
};

const INITIAL_VIEW = {
  longitude: 79.0,
  latitude: 22.5,
  zoom: 4.5,
  pitch: 0,
  bearing: 0
};

const MAJOR_STATIONS = new Set(["NDLS","CSMT","HWH","MAS","SBC","BZA","NGP","BPL","KOTA","PUNE","HYB","SC","BSP","TATA","VSKP","BBS","DR","LKO","AGC","ET","BPQ","RTM","BRC","ST","BSR","RU","GTL","WADI","SUR","JTJ","SA","CBE","ERS","TVC","NJP","GHY"]);

// White train-shaped mask icon; tinted per-train via getColor (mask:true).
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

// ---- viewport culling + LOD helpers ------------------------------------ #
function viewportBounds(vs: any, pad = 0.4) {
  const lngSpan = 360 / Math.pow(2, vs.zoom);
  const latSpan = 170 / Math.pow(2, vs.zoom);
  return {
    minLng: vs.longitude - lngSpan * (0.5 + pad),
    maxLng: vs.longitude + lngSpan * (0.5 + pad),
    minLat: vs.latitude - latSpan * (0.5 + pad),
    maxLat: vs.latitude + latSpan * (0.5 + pad),
  };
}
function inBounds(p: LngLat, b: any) {
  return p[0] >= b.minLng && p[0] <= b.maxLng && p[1] >= b.minLat && p[1] <= b.maxLat;
}
function sectionInBounds(s: Section, b: any) {
  return s.geometry.some((p) => inBounds(p, b));
}

export default function NetworkMap() {
  const net = useStore((s) => s.net);
  const states = useStore((s) => s.states);
  const conflicts = useStore((s) => s.conflicts);
  const cascade = useStore((s) => s.cascade);
  const selectedTrain = useStore((s) => s.selectedTrain);
  const trackTrain = useStore((s) => s.trackTrain);
  const passengerLayer = useStore((s) => s.passengerLayer);
  const selectTrain = useStore((s) => s.selectTrain);
  const showCascade = useStore((s) => s.showCascade);

  const [viewState, setViewState] = useState<any>(INITIAL_VIEW);
  const [, setFrame] = useState(0);

  // per-train animated values + recent-position trail (refs => survive renders)
  const animRef = useRef<Record<string, Anim>>({});
  const trailRef = useRef<Record<string, LngLat[]>>({});
  const renderedRef = useRef<Record<string, { pos: LngLat; bearing: number; rgb: [number, number, number] }>>({});
  const rgbRef = useRef<Record<string, [number, number, number]>>({});
  const frameCount = useRef(0);

  // ---- the render clock: 60fps interpolation, decoupled from the sim tick --- #
  useEffect(() => {
    let raf = 0;
    let lastT = performance.now();
    const loop = () => {
      const now = performance.now();
      const dtReal = (now - lastT) / 1000;
      lastT = now;
      stepInterpolation(dtReal, now);
      frameCount.current++;
      setFrame((f) => (f + 1) % 1_000_000);
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
      if (!geom) continue;
      const total = geom.cum[geom.cum.length - 1];
      if (!t.active) {
        // reset so re-entry doesn't tween across the whole line
        delete animRef.current[t.number];
        trailRef.current[t.number] = [];
        continue;
      }
      // authoritative distance, dead-reckoned forward in live mode between ticks
      const target = Math.max(
        0,
        Math.min(total, t.distKm + (live ? (t.speedKmh * snapAgeSec) / 3600 : 0))
      );
      let a = animRef.current[t.number];
      if (!a || !a.initialized) {
        a = { dist: target, bearing: t.bearing, initialized: true };
        animRef.current[t.number] = a;
      }
      // ease toward target (snappier in local mode where target is already 60fps)
      const k = Math.min(1, dtReal * (live ? 6 : 12));
      a.dist += (target - a.dist) * k;

      const { pos, bearing } = interpAlong(geom.polyline, geom.cum, a.dist);
      a.bearing = lerpAngle(a.bearing, bearing, Math.min(1, dtReal * 8));

      // smooth status colour transition
      const targetRgb = STATUS_RGB[t.status] ?? [200, 200, 200];
      const cur = rgbRef.current[t.number] ?? targetRgb;
      const ck = Math.min(1, dtReal * 4);
      const rgb: [number, number, number] = [
        cur[0] + (targetRgb[0] - cur[0]) * ck,
        cur[1] + (targetRgb[1] - cur[1]) * ck,
        cur[2] + (targetRgb[2] - cur[2]) * ck
      ];
      rgbRef.current[t.number] = rgb;
      renderedRef.current[t.number] = { pos, bearing: a.bearing, rgb };

      // trail: sample periodically for a ~1.5s comet tail
      if (frameCount.current % 4 === 0 && t.speedKmh > 1) {
        const trail = (trailRef.current[t.number] ||= []);
        trail.push(pos);
        if (trail.length > 18) trail.shift();
      }
    }
  }

  const pulse = (performance.now() % 1200) / 1200;

  // follow the tracked train
  const trackedRender = trackTrain ? renderedRef.current[trackTrain] : undefined;
  useEffect(() => {
    const r = trackTrain ? renderedRef.current[trackTrain] : undefined;
    if (r) {
      setViewState((v: any) => ({
        ...v,
        longitude: r.pos[0],
        latitude: r.pos[1],
        zoom: Math.max(v.zoom, 10.5),
        transitionDuration: 600
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackTrain]);

  // zoom-to-fit route when requested by tracker
  useEffect(() => {
    const fitRoute = useStore.getState().fitRoute;
    if (!fitRoute || fitRoute.length === 0) return;
    const stations = useStore.getState().net.stations;
    const coords: LngLat[] = [];
    for (const code of fitRoute) {
      const st = stations.find((s) => s.code === code);
      if (st) coords.push([st.lng, st.lat]);
    }
    if (coords.length === 0) return;
    const lats = coords.map((c) => c[1]);
    const lngs = coords.map((c) => c[0]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const latDiff = Math.max(0.5, maxLat - minLat);
    const lngDiff = Math.max(0.5, maxLng - minLng);
    const zoomLat = Math.log2(170 / (latDiff * 1.4));
    const zoomLng = Math.log2(360 / (lngDiff * 1.4));
    const zoom = Math.min(Math.max(Math.min(zoomLat, zoomLng), 4), 14);
    setViewState((v: any) => ({
      ...v,
      longitude: (minLng + maxLng) / 2,
      latitude: (minLat + maxLat) / 2,
      zoom,
      transitionDuration: 900
    }));
    useStore.getState().setFitRoute(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useStore.getState().fitRoute]);

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

  // viewport culling
  const bounds = viewportBounds(viewState);
  const vizSections = useMemo(
    () => net.sections.filter((s) => sectionInBounds(s, bounds)),
    [net.sections, bounds.minLng, bounds.maxLng, bounds.minLat, bounds.maxLat]
  );
  const vizStations = useMemo(
    () => net.stations.filter((st) => inBounds([st.lng, st.lat], bounds)),
    [net.stations, bounds.minLng, bounds.maxLng, bounds.minLat, bounds.maxLat]
  );
  const vizActive = useMemo(
    () => active.filter((t) => inBounds(renderedRef.current[t.number]?.pos ?? t.position, bounds)),
    [active, bounds.minLng, bounds.maxLng, bounds.minLat, bounds.maxLat]
  );
  const zoom = viewState.zoom;
  const showAllLabels = zoom >= 6;
  const showMajorLabels = zoom >= 4.5;
  const stationLabelData = useMemo(
    () => vizStations.filter((s) => showAllLabels || (showMajorLabels && MAJOR_STATIONS.has(s.code))),
    [vizStations, showAllLabels, showMajorLabels]
  );

  const layers = useMemo(() => {
    const ls: any[] = [];

    // base tracks
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
              200
            ];
          }
          if (d.line === "single") return [120, 95, 40, 200];
          return [46, 54, 66, 220];
        },
        getWidth: (d) => (d.line === "single" ? 3.4 : 2.6),
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true
      })
    );

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

    // stations + labels
    ls.push(
      new ScatterplotLayer({
        id: "stations",
        data: vizStations,
        getPosition: (d: any) => [d.lng, d.lat],
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
        getPosition: (d: any) => [d.lng, d.lat],
        getText: (d: any) => d.code,
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

    // conflict pulses
    const cz = conflicts.map((c) => ({ c, pos: conflictPos(net, c) })).filter((x) => x.pos);
    ls.push(
      new ScatterplotLayer({
        id: "conflict-glow",
        data: cz,
        getPosition: (d: any) => d.pos,
        getRadius: () => 14 + pulse * 16,
        radiusUnits: "pixels",
        getFillColor: (d: any) =>
          d.c.severity === "critical"
            ? [255, 92, 92, Math.round(90 - pulse * 70)]
            : [245, 176, 39, Math.round(80 - pulse * 60)],
        updateTriggers: { getRadius: pulse, getFillColor: pulse }
      })
    );

    // motion trails (comet tails) — one PathLayer over all active trains
    const trailData = active
      .map((t) => ({ number: t.number, path: trailRef.current[t.number] ?? [], rgb: rgbRef.current[t.number] }))
      .filter((d) => d.path.length > 1);
    ls.push(
      new PathLayer({
        id: "train-trails",
        data: trailData,
        getPath: (d: any) => d.path,
        getColor: (d: any) => {
          const c = d.rgb ?? [120, 200, 220];
          return [Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), 70];
        },
        getWidth: 2.2,
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
        updateTriggers: { getPath: frameCount.current, getColor: frameCount.current }
      })
    );

    // glow under each train
    ls.push(
      new ScatterplotLayer({
        id: "train-glow",
        data: vizActive,
        getPosition: (d: TrainState) => renderedRef.current[d.number]?.pos ?? d.position,
        getRadius: (d: TrainState) => (d.number === selectedTrain ? 17 : 12),
        radiusUnits: "pixels",
        getFillColor: (d: TrainState) => {
          const c = rgbRef.current[d.number] ?? STATUS_RGB[d.status] ?? [200, 200, 200];
          return [Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), 55];
        },
        updateTriggers: { getPosition: frameCount.current, getRadius: selectedTrain, getFillColor: frameCount.current }
      })
    );

    // cascade ring
    ls.push(
      new ScatterplotLayer({
        id: "cascade-ring",
        data: vizActive.filter((t) => cascadeTrains.has(t.number)),
        getPosition: (d: TrainState) => renderedRef.current[d.number]?.pos ?? d.position,
        getRadius: 14 + pulse * 6,
        radiusUnits: "pixels",
        stroked: true,
        filled: false,
        getLineColor: [58, 208, 222, 230],
        lineWidthMinPixels: 2,
        updateTriggers: { getPosition: frameCount.current, getRadius: pulse }
      })
    );

    // oriented elongated train markers
    ls.push(
      new IconLayer({
        id: "trains",
        data: vizActive,
        getIcon: () => TRAIN_ICON as any,
        getPosition: (d: TrainState) => renderedRef.current[d.number]?.pos ?? d.position,
        getAngle: (d: TrainState) => -(renderedRef.current[d.number]?.bearing ?? d.bearing),
        getSize: (d: TrainState) => (d.number === selectedTrain ? 26 : 21),
        sizeUnits: "pixels",
        getColor: (d: TrainState) => {
          const c = rgbRef.current[d.number] ?? STATUS_RGB[d.status] ?? [220, 220, 220];
          return [Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), 255];
        },
        pickable: true,
        onClick: (info: any) => {
          if (info.object) {
            selectTrain(info.object.number);
            if (info.object.delayMinutes > 0) showCascade(info.object.number);
          }
        },
        updateTriggers: {
          getPosition: frameCount.current,
          getAngle: frameCount.current,
          getColor: frameCount.current,
          getSize: selectedTrain
        }
      })
    );

    // train number labels
    ls.push(
      new TextLayer({
        id: "train-labels",
        data: vizActive,
        getPosition: (d: TrainState) => renderedRef.current[d.number]?.pos ?? d.position,
        getText: (d: TrainState) => d.number,
        getSize: 11,
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
        updateTriggers: { getPosition: frameCount.current, getColor: frameCount.current }
      })
    );

    return ls;
    // frameCount.current in deps via setFrame re-render keeps positions fresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    net,
    vizSections,
    vizStations,
    vizActive,
    stationLabelData,
    conflicts,
    pulse,
    selectedTrain,
    cascadeSections,
    cascadeTrains,
    passengerLayer,
    paxBySection,
    selectTrain,
    showCascade
  ]);

  return (
    <div className="absolute inset-0">
      <DeckGL
        views={new MapView({ repeat: false })}
        viewState={viewState}
        onViewStateChange={(e: any) => setViewState(e.viewState)}
        controller={true}
        layers={layers}
        getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
      >
        <Map
          mapStyle={DARK_STYLE as any}
          mapLib={maplibregl}
          attributionControl={false}
        />
      </DeckGL>
    </div>
  );
}

function conflictPos(net: any, c: Conflict): LngLat | null {
  const sec = net.sectionMap[c.location];
  if (sec) return sectionMid(sec);
  const sta = net.stationMap[c.location];
  if (sta) return [sta.lng, sta.lat];
  return null;
}
