"use client";
import { useMemo, useState, useEffect } from "react";
import DeckGL from "@deck.gl/react";
import { MapView } from "@deck.gl/core";
import { PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { useStore } from "@/store/useStore";
import type { Conflict, LngLat, Section, TrainState } from "@/lib/types";

const STATUS_RGB: Record<string, [number, number, number]> = {
  running: [55, 217, 154],
  scheduled: [120, 130, 145],
  delayed: [245, 176, 39],
  held: [255, 92, 92],
  conflict: [255, 92, 92],
  arrived: [90, 100, 115]
};

const INITIAL_VIEW = {
  longitude: 73.18,
  latitude: 19.32,
  zoom: 8.7,
  pitch: 0,
  bearing: 0
};

function sectionMid(sec: Section): LngLat {
  const g = sec.geometry;
  return g[Math.floor(g.length / 2)];
}

function canonical(id: string): string {
  const [a, b] = id.split("-");
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export default function NetworkMap() {
  const net = useStore((s) => s.net);
  const states = useStore((s) => s.states);
  const conflicts = useStore((s) => s.conflicts);
  const blocked = useStore((s) => s.blocked);
  const cascade = useStore((s) => s.cascade);
  const selectedTrain = useStore((s) => s.selectedTrain);
  const trackTrain = useStore((s) => s.trackTrain);
  const passengerLayer = useStore((s) => s.passengerLayer);
  const selectTrain = useStore((s) => s.selectTrain);
  const showCascade = useStore((s) => s.showCascade);

  const [viewState, setViewState] = useState<any>(INITIAL_VIEW);
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setPulse((Date.now() % 1200) / 1200);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // follow the tracked train
  const tracked = states.find((t) => t.number === trackTrain && t.active);
  useEffect(() => {
    if (tracked) {
      setViewState((v: any) => ({
        ...v,
        longitude: tracked.position[0],
        latitude: tracked.position[1],
        zoom: Math.max(v.zoom, 10.5),
        transitionDuration: 600
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackTrain, tracked?.position[0], tracked?.position[1]]);

  const cascadeSections = useMemo(
    () => new Set(cascade?.sections ?? []),
    [cascade]
  );
  const cascadeTrains = useMemo(
    () => new Set(cascade?.trains ?? []),
    [cascade]
  );

  // passenger impact per section (sum of pax on trains currently on it)
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

  const layers = useMemo(() => {
    const ls: any[] = [];

    // base tracks
    ls.push(
      new PathLayer<Section>({
        id: "tracks",
        data: net.sections,
        getPath: (d) => d.geometry,
        getColor: (d) => {
          const k = canonical(d.id);
          if (isBlocked(blocked, d.id)) return [255, 92, 92, 230];
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
        jointRounded: true,
        pickable: false
      })
    );

    // cascade / reroute highlight (cyan)
    if (cascadeSections.size) {
      ls.push(
        new PathLayer<Section>({
          id: "cascade-path",
          data: net.sections.filter((s) => cascadeSections.has(canonical(s.id))),
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

    // stations
    ls.push(
      new ScatterplotLayer({
        id: "stations",
        data: net.stations,
        getPosition: (d: any) => [d.lng, d.lat],
        getRadius: 3,
        radiusUnits: "pixels",
        getFillColor: [200, 210, 222, 230],
        getLineColor: [11, 13, 17, 255],
        lineWidthMinPixels: 1,
        stroked: true,
        pickable: true,
        onClick: () => {}
      })
    );
    ls.push(
      new TextLayer({
        id: "station-labels",
        data: net.stations,
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
        getRadius: (d: any) => 14 + pulse * 16,
        radiusUnits: "pixels",
        getFillColor: (d: any) =>
          d.c.severity === "critical"
            ? [255, 92, 92, Math.round(90 - pulse * 70)]
            : [245, 176, 39, Math.round(80 - pulse * 60)],
        updateTriggers: { getRadius: pulse, getFillColor: pulse }
      })
    );

    // active trains — outer glow
    const active = states.filter((t) => t.active);
    ls.push(
      new ScatterplotLayer({
        id: "train-glow",
        data: active,
        getPosition: (d: TrainState) => d.position,
        getRadius: (d: TrainState) => (d.number === selectedTrain ? 16 : 11),
        radiusUnits: "pixels",
        getFillColor: (d: TrainState) => {
          const c = STATUS_RGB[d.status] ?? [200, 200, 200];
          return [c[0], c[1], c[2], 60];
        },
        updateTriggers: { getRadius: selectedTrain }
      })
    );
    // cascade ring on affected trains
    ls.push(
      new ScatterplotLayer({
        id: "cascade-ring",
        data: active.filter((t) => cascadeTrains.has(t.number)),
        getPosition: (d: TrainState) => d.position,
        getRadius: 13 + pulse * 6,
        radiusUnits: "pixels",
        stroked: true,
        filled: false,
        getLineColor: [58, 208, 222, 230],
        lineWidthMinPixels: 2,
        updateTriggers: { getRadius: pulse }
      })
    );
    // core dot
    ls.push(
      new ScatterplotLayer({
        id: "train-core",
        data: active,
        getPosition: (d: TrainState) => d.position,
        getRadius: (d: TrainState) => (d.number === selectedTrain ? 6.5 : 5),
        radiusUnits: "pixels",
        getFillColor: (d: TrainState) => STATUS_RGB[d.status] ?? [200, 200, 200],
        stroked: true,
        getLineColor: [11, 13, 17, 255],
        lineWidthMinPixels: 1.5,
        pickable: true,
        onClick: (info: any) => {
          if (info.object) {
            selectTrain(info.object.number);
            if (info.object.delayMinutes > 0) showCascade(info.object.number);
          }
        },
        updateTriggers: { getRadius: selectedTrain }
      })
    );
    // train number labels
    ls.push(
      new TextLayer({
        id: "train-labels",
        data: active,
        getPosition: (d: TrainState) => d.position,
        getText: (d: TrainState) => d.number,
        getSize: 11,
        getColor: (d: TrainState) => {
          const c = STATUS_RGB[d.status] ?? [231, 234, 240];
          return [c[0], c[1], c[2], 255];
        },
        getPixelOffset: [0, -13],
        fontFamily: "monospace",
        fontWeight: 700,
        characterSet: "auto",
        getTextAnchor: "middle",
        getAlignmentBaseline: "bottom",
        billboard: true
      })
    );

    return ls;
  }, [
    net,
    states,
    conflicts,
    blocked,
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
        style={{ background: "transparent" }}
      />
    </div>
  );
}

function isBlocked(blocked: Set<string>, id: string): boolean {
  if (blocked.has(id)) return true;
  const [a, b] = id.split("-");
  return blocked.has(`${b}-${a}`);
}

function conflictPos(net: any, c: Conflict): LngLat | null {
  const sec = net.sectionMap[c.location];
  if (sec) return sectionMid(sec);
  const sta = net.stationMap[c.location];
  if (sta) return [sta.lng, sta.lat];
  return null;
}
