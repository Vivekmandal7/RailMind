/** Default viewport — all of India visible on screen. */
export const INDIA_CENTER: [number, number] = [79, 22];

/** SW / NE corners for fitBounds (lng, lat). */
export const INDIA_BOUNDS: [[number, number], [number, number]] = [
  [68.1, 6.5],
  [97.4, 35.5]
];

export const INDIA_FIT_PADDING = 48;
export const INDIA_FLY_DURATION_MS = 1400;

export const MAPBOX_DARK_STYLE = "mapbox://styles/mapbox/dark-v11";
/** Real satellite imagery + road/place labels — the "see the real thing" view. */
export const MAPBOX_SATELLITE_STYLE = "mapbox://styles/mapbox/satellite-streets-v12";
