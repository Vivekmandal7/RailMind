import indiaStationsGeo from "@/data/india_stations.geojson";
import indiaSectionsGeo from "@/data/india_sections.geojson";
import { lodForZoom } from "./geometryLod";

export type LngLat = [number, number];

export interface RailStation {
  code: string;
  name: string;
  lng: number;
  lat: number;
  major: boolean;
}

export interface RailRoute {
  id: string;
  from: string;
  to: string;
  line: "single" | "double";
  ghat: boolean;
  geometry: LngLat[];
}

export interface IndiaRailNetwork {
  stations: RailStation[];
  routes: RailRoute[];
}

/** Major junctions — labels shown only at higher zoom. */
export const MAJOR_STATION_CODES = new Set([
  "NDLS", "CSMT", "HWH", "MAS", "SBC", "BZA", "NGP", "BPL", "KOTA", "PUNE", "HYB", "SC",
  "BSP", "TATA", "VSKP", "BBS", "DR", "LKO", "AGC", "ET", "BPQ", "RTM", "BRC", "ST", "BSR",
  "RU", "GTL", "WADI", "SUR", "JTJ", "SA", "CBE", "ERS", "TVC", "NJP", "GHY", "KYN", "IGP",
  "CNB", "ALD", "BSB", "PNBE", "KGP", "NZM"
]);

let cached: IndiaRailNetwork | null = null;

export function loadIndiaRailNetwork(): IndiaRailNetwork {
  if (cached) return cached;

  const stations: RailStation[] = indiaStationsGeo.features.map((f) => {
    const code = String(f.properties.code ?? "");
    return {
      code,
      name: String(f.properties.name ?? code),
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      major: MAJOR_STATION_CODES.has(code)
    };
  });

  const routes: RailRoute[] = indiaSectionsGeo.features.map((f) => {
    const from = String(f.properties.from);
    const to = String(f.properties.to);
    const line = f.properties.line === "single" ? "single" : "double";
    return {
      id: `${from}-${to}`,
      from,
      to,
      line,
      ghat: Boolean(f.properties.ghat) || line === "single",
      geometry: f.geometry.coordinates as LngLat[]
    };
  });

  cached = { stations, routes };
  return cached;
}

export interface ViewBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface MapBoundsLike {
  getBounds(): {
    getWest(): number;
    getSouth(): number;
    getEast(): number;
    getNorth(): number;
  } | null;
}

export function boundsFromMap(map: MapBoundsLike, padDeg = 0.35): ViewBounds {
  const b = map.getBounds();
  if (!b) {
    return { west: 68, south: 6, east: 98, north: 36 };
  }
  return {
    west: b.getWest() - padDeg,
    south: b.getSouth() - padDeg,
    east: b.getEast() + padDeg,
    north: b.getNorth() + padDeg
  };
}

export function pointInBounds(lng: number, lat: number, b: ViewBounds): boolean {
  return lng >= b.west && lng <= b.east && lat >= b.south && lat <= b.north;
}

export function routeInBounds(route: RailRoute, b: ViewBounds): boolean {
  return route.geometry.some(([lng, lat]) => pointInBounds(lng, lat, b));
}

/** Decimate polyline vertices for low zoom — memoized tiered LOD. */
export function simplifyRoute(geometry: LngLat[], zoom: number): LngLat[] {
  return lodForZoom(geometry, zoom);
}
