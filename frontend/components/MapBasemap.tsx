"use client";
import { useCallback, useEffect, useRef } from "react";
import { Map } from "react-map-gl/maplibre";
import maplibregl, { type MapLibreEvent } from "maplibre-gl";

/** Reliable dark raster basemap — CARTO CDN with OSM attribution. */
export const DARK_STYLE = {
  version: 8,
  sources: {
    "carto-dark": {
      type: "raster" as const,
      tiles: ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
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

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  return e.name === "AbortError" || /aborted/i.test(e.message ?? "");
}

/**
 * MapLibre basemap with a StrictMode-safe singleton lifecycle.
 * The init guard prevents double-creation during React 18 dev double-mount.
 */
export default function MapBasemap() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const initGuard = useRef(false);

  const handleLoad = useCallback((e: MapLibreEvent) => {
    if (initGuard.current && mapRef.current) return;
    initGuard.current = true;
    const map = e.target;
    mapRef.current = map;

    map.on("error", (ev) => {
      const err = (ev as { error?: Error }).error ?? ev;
      if (isAbortError(err)) return;
      console.warn("[MapLibre]", ev);
    });
  }, []);

  useEffect(() => {
    return () => {
      const map = mapRef.current;
      if (map) {
        try {
          map.remove();
        } catch {
          /* already removed */
        }
        mapRef.current = null;
        initGuard.current = false;
      }
    };
  }, []);

  return (
    <Map
      mapStyle={DARK_STYLE as maplibregl.StyleSpecification}
      mapLib={maplibregl}
      attributionControl={false}
      onLoad={handleLoad}
    />
  );
}
