import stationsGeo from "@/data/stations.geojson";
import sectionsGeo from "@/data/sections.geojson";
import indiaStationsGeo from "@/data/india_stations.geojson";
import indiaSectionsGeo from "@/data/india_sections.geojson";
import timetable from "@/data/timetable.json";
import indiaTimetable from "@/data/india_timetable.json";
import { polylineCum, parseHHMM } from "./geo";
import type { NetworkDTO } from "./contract";
import type {
  LngLat,
  NetworkData,
  Section,
  Station,
  Train
} from "./types";

/**
 * Parse the seeded GeoJSON + timetable into typed network structures.
 * This is the single entry point the simulation engine consumes.
 */
export function loadNetwork(): NetworkData {
  const stations: Station[] = stationsGeo.features.map((f) => ({
    code: f.properties.code,
    name: f.properties.name,
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    platforms: f.properties.platforms ?? 2
  }));
  const stationMap: Record<string, Station> = {};
  for (const s of stations) stationMap[s.code] = s;

  const sections: Section[] = sectionsGeo.features.map((f) => {
    const geometry = f.geometry.coordinates as LngLat[];
    const { total } = polylineCum(geometry);
    return {
      id: `${f.properties.from}-${f.properties.to}`,
      from: f.properties.from,
      to: f.properties.to,
      line: f.properties.line,
      capacity: f.properties.capacity,
      ghat: f.properties.ghat ?? false,
      geometry,
      lengthKm: total
    };
  });
  const sectionMap: Record<string, Section> = {};
  for (const sec of sections) {
    // index both directions for lookup
    sectionMap[sec.id] = sec;
    sectionMap[`${sec.to}-${sec.from}`] = sec;
  }

  const trains: Train[] = timetable.trains.map((t) =>
    buildTrain(t, stationMap, sectionMap)
  );

  return { stations, sections, trains, stationMap, sectionMap };
}

function buildTrain(
  t: (typeof timetable.trains)[number],
  stationMap: Record<string, Station>,
  sectionMap: Record<string, Section>
): Train {
  // Build the flattened polyline from consecutive route stations.
  const polyline: LngLat[] = [];
  const cumDistKm: number[] = [];
  let runningKm = 0;

  for (let i = 0; i < t.route.length; i++) {
    const code = t.route[i];
    cumDistKm.push(runningKm);
    if (i === 0) {
      const st = stationMap[code];
      polyline.push([st.lng, st.lat]);
      continue;
    }
    const prev = t.route[i - 1];
    const sec = sectionMap[`${prev}-${code}`];
    if (!sec) {
      // fallback: straight line between stations
      const st = stationMap[code];
      polyline.push([st.lng, st.lat]);
      runningKm += haversineKmStations(stationMap[prev], st);
      cumDistKm[cumDistKm.length - 1] = runningKm;
      continue;
    }
    // orient section geometry to match travel direction
    let geom = sec.geometry;
    if (sec.from !== prev) geom = [...geom].reverse();
    // skip first vertex (already added) to avoid duplicate
    for (let j = 1; j < geom.length; j++) polyline.push(geom[j]);
    runningKm += sec.lengthKm;
    cumDistKm[cumDistKm.length - 1] = runningKm;
  }

  const { cum: polyCumKm } = polylineCum(polyline);

  return {
    number: t.number,
    name: t.name,
    type: t.type as Train["type"],
    direction: t.direction as Train["direction"],
    coaches: t.coaches,
    capacityPax: t.capacityPax,
    route: t.route,
    schedule: t.schedule.map((s) => ({
      station: s.station,
      arr: parseHHMM(s.arr),
      dep: parseHHMM(s.dep)
    })),
    cumDistKm,
    polyline,
    polyCumKm
  };
}

function haversineKmStations(a: Station, b: Station): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** India-wide network for local fallback (matches backend india_wide config). */
export function loadIndiaNetwork(): NetworkData {
  const stations: Station[] = indiaStationsGeo.features.map((f) => ({
    code: String(f.properties.code ?? ""),
    name: String(f.properties.name ?? f.properties.code ?? ""),
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    platforms: Number(f.properties.platforms ?? 2)
  }));
  const stationMap: Record<string, Station> = {};
  for (const s of stations) stationMap[s.code] = s;

  const sections: Section[] = indiaSectionsGeo.features.map((f) => {
    const geometry = f.geometry.coordinates as LngLat[];
    const { total } = polylineCum(geometry);
    const line = f.properties.line === "single" ? "single" : "double";
    return {
      id: `${f.properties.from}-${f.properties.to}`,
      from: String(f.properties.from),
      to: String(f.properties.to),
      line,
      capacity: Number(f.properties.capacity ?? 4),
      ghat: line === "single",
      geometry,
      lengthKm: total
    };
  });
  const sectionMap: Record<string, Section> = {};
  for (const sec of sections) {
    sectionMap[sec.id] = sec;
    sectionMap[`${sec.to}-${sec.from}`] = sec;
  }

  const trains: Train[] = indiaTimetable.trains.map((t) =>
    buildTrain(t, stationMap, sectionMap)
  );

  return { stations, sections, trains, stationMap, sectionMap };
}

/** Convert a backend NetworkDTO into the frontend NetworkData shape. */
export function networkFromDTO(dto: NetworkDTO): NetworkData {
  const stations: Station[] = dto.stations.map((s) => ({
    code: s.code,
    name: s.name,
    lat: s.lat,
    lng: s.lng,
    platforms: s.platforms
  }));
  const stationMap: Record<string, Station> = {};
  for (const s of stations) stationMap[s.code] = s;

  const sections: Section[] = dto.sections.map((s) => ({
    id: s.id,
    from: s.from,
    to: s.to,
    line: s.line,
    capacity: s.capacity,
    ghat: s.ghat,
    geometry: s.geometry as LngLat[],
    lengthKm: s.length_km
  }));
  const sectionMap: Record<string, Section> = {};
  for (const sec of sections) {
    sectionMap[sec.id] = sec;
    sectionMap[`${sec.to}-${sec.from}`] = sec;
  }

  const trains: Train[] = dto.trains.map((t) => ({
    number: t.number,
    name: t.name,
    type: t.type as Train["type"],
    direction: t.direction as Train["direction"],
    coaches: t.coaches,
    capacityPax: t.capacity_pax,
    route: t.route,
    schedule: [],
    cumDistKm: [],
    polyline: t.polyline as LngLat[],
    polyCumKm: t.cum_km
  }));

  return { stations, sections, trains, stationMap, sectionMap };
}

/** Earliest and latest scheduled seconds across all trains — defines the sim window. */
export function simWindow(net: NetworkData): { start: number; end: number } {
  let start = Infinity;
  let end = -Infinity;
  for (const tr of net.trains) {
    if (tr.schedule.length === 0) continue;
    start = Math.min(start, tr.schedule[0].dep);
    end = Math.max(end, tr.schedule[tr.schedule.length - 1].arr);
  }
  if (!Number.isFinite(start)) return { start: 9 * 3600, end: 18 * 3600 };
  return { start: start - 120, end: end + 300 };
}

/** Bounding box center + zoom hint for fitting the whole network on first load. */
export function networkViewport(net: NetworkData): {
  longitude: number;
  latitude: number;
  zoom: number;
} {
  const coords: LngLat[] = [];
  for (const s of net.stations) coords.push([s.lng, s.lat]);
  if (coords.length === 0) return { longitude: 79.0, latitude: 22.5, zoom: 4.5 };
  const lats = coords.map((c) => c[1]);
  const lngs = coords.map((c) => c[0]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latDiff = Math.max(0.15, maxLat - minLat);
  const lngDiff = Math.max(0.15, maxLng - minLng);
  const zoomLat = Math.log2(170 / (latDiff * 1.5));
  const zoomLng = Math.log2(360 / (lngDiff * 1.5));
  return {
    longitude: (minLng + maxLng) / 2,
    latitude: (minLat + maxLat) / 2,
    zoom: Math.min(Math.max(Math.min(zoomLat, zoomLng), 4), 12)
  };
}
