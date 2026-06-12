import type mapboxgl from "mapbox-gl";

/**
 * OpenRailwayMap raster overlay — the real railway infrastructure layer
 * (tracks, signals, electrification, speed limits) rendered by the
 * OpenRailwayMap community from OpenStreetMap data, exactly like
 * openrailwaymap.org.
 *
 * Free community tile service: usage stays moderate (one overlay, no
 * prefetch) and attribution is attached to the source so it shows in the
 * map's attribution control whenever the overlay is on.
 *
 * The tiles are designed for light basemaps; on our dark control-room style
 * we lift brightness-min and trim saturation/contrast so the coloured
 * infrastructure lines read crisply without washing out the basemap.
 */
export type OrmStyle = "off" | "standard" | "maxspeed" | "signals" | "electrification";

export const ORM_STYLE_OPTIONS: { key: Exclude<OrmStyle, "off">; label: string; hint: string }[] = [
  { key: "standard", label: "Infrastructure", hint: "Tracks, tunnels, bridges, usage" },
  { key: "maxspeed", label: "Speed", hint: "Permitted line speeds" },
  { key: "signals", label: "Signals", hint: "Signalling along the line" },
  { key: "electrification", label: "Power", hint: "Electrified vs diesel territory" }
];

export const ORM_SOURCE_ID = "openrailwaymap-tiles";
export const ORM_LAYER_ID = "openrailwaymap-overlay";

const ORM_ATTRIBUTION =
  'Rail data © <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a> (CC-BY-SA) · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function ormTileUrls(style: Exclude<OrmStyle, "off">): string[] {
  return ["a", "b", "c"].map(
    (sub) => `https://${sub}.tiles.openrailwaymap.org/${style}/{z}/{x}/{y}.png`
  );
}

/** First symbol layer of the current basemap style — inserting the raster
 *  before it keeps the overlay above land/roads but below place labels.
 *  deck.gl's interleaved layers live at the end of the stack, so trains and
 *  conflict pulses always draw above the overlay. */
function firstSymbolLayerId(map: mapboxgl.Map): string | undefined {
  const layers = map.getStyle()?.layers ?? [];
  return layers.find((l) => l.type === "symbol")?.id;
}

/** Idempotently (re)apply the overlay for `style` at `opacity` (0–1).
 *  Returns false when the map style isn't ready yet — caller retries. */
export function applyOrmOverlay(
  map: mapboxgl.Map,
  style: OrmStyle,
  opacity: number
): boolean {
  if (style === "off") {
    removeOrmOverlay(map);
    return true;
  }
  try {
    // Switching ORM style means different tile URLs → drop and re-add the source.
    const src = map.getSource(ORM_SOURCE_ID) as
      | (mapboxgl.RasterTileSource & { tiles?: string[] })
      | undefined;
    if (src && !(src.tiles?.[0] ?? "").includes(`/${style}/`)) {
      removeOrmOverlay(map);
    }
    if (!map.getSource(ORM_SOURCE_ID)) {
      map.addSource(ORM_SOURCE_ID, {
        type: "raster",
        tiles: ormTileUrls(style),
        tileSize: 256,
        minzoom: 2,
        maxzoom: 19,
        attribution: ORM_ATTRIBUTION
      });
    }
    if (!map.getLayer(ORM_LAYER_ID)) {
      map.addLayer(
        {
          id: ORM_LAYER_ID,
          type: "raster",
          source: ORM_SOURCE_ID,
          paint: {
            "raster-opacity": clampOpacity(opacity),
            "raster-contrast": 0.15,
            "raster-saturation": 0.25,
            "raster-brightness-min": 0.12,
            "raster-fade-duration": 220
          }
        },
        firstSymbolLayerId(map)
      );
    } else {
      map.setPaintProperty(ORM_LAYER_ID, "raster-opacity", clampOpacity(opacity));
    }
    return true;
  } catch {
    // Style mid-swap (setStyle in flight) — the style.load / idle re-apply
    // path will land it.
    return false;
  }
}

export function setOrmOpacity(map: mapboxgl.Map, opacity: number): void {
  try {
    if (map.getLayer(ORM_LAYER_ID)) {
      map.setPaintProperty(ORM_LAYER_ID, "raster-opacity", clampOpacity(opacity));
    }
  } catch {
    /* style mid-swap — re-apply path handles it */
  }
}

export function removeOrmOverlay(map: mapboxgl.Map): void {
  try {
    if (map.getLayer(ORM_LAYER_ID)) map.removeLayer(ORM_LAYER_ID);
    if (map.getSource(ORM_SOURCE_ID)) map.removeSource(ORM_SOURCE_ID);
  } catch {
    /* style already gone (setStyle wiped it) — nothing to remove */
  }
}

function clampOpacity(o: number): number {
  return Math.min(1, Math.max(0, o));
}
