import type { LngLat } from "./indiaRailNetwork";

/**
 * Zoom-based level-of-detail for track polylines.
 *
 * With real OSM geometry a single corridor section can carry thousands of
 * vertices. Drawing them all at national zoom wastes GPU time on sub-pixel
 * segments, while re-decimating on every map move wastes CPU and forces
 * deck.gl to re-upload attributes. So: three fixed tiers (full / ÷4 / ÷16),
 * decimated once per polyline and memoized, with endpoints always preserved
 * (section endpoints are station coordinates — the stitching contract).
 *
 * LOD applies to track *drawing* only. Train *motion* always interpolates
 * along the full-resolution polyline.
 */
export type LodTier = 0 | 1 | 2;

export function lodTierForZoom(zoom: number): LodTier {
  if (zoom >= 10) return 0; // close-up: every real curve visible
  if (zoom >= 7) return 1; // corridor overview: ÷4
  return 2; // national: ÷16
}

const LOD_STEP: Record<LodTier, number> = { 0: 1, 1: 4, 2: 16 };

const polyCache = new WeakMap<LngLat[], Partial<Record<LodTier, LngLat[]>>>();

/** Decimated copy of `coords` for the tier — memoized, endpoint-preserving. */
export function lodPolyline(coords: LngLat[], tier: LodTier): LngLat[] {
  const step = LOD_STEP[tier];
  if (step <= 1 || coords.length <= step + 1) return coords;
  let entry = polyCache.get(coords);
  if (!entry) {
    entry = {};
    polyCache.set(coords, entry);
  }
  const hit = entry[tier];
  if (hit) return hit;
  const out: LngLat[] = [coords[0]];
  for (let i = step; i < coords.length - 1; i += step) out.push(coords[i]);
  out.push(coords[coords.length - 1]);
  entry[tier] = out;
  return out;
}

/** Convenience: decimate for the current zoom. */
export function lodForZoom(coords: LngLat[], zoom: number): LngLat[] {
  return lodPolyline(coords, lodTierForZoom(zoom));
}

/**
 * Memoized per-tier derivation from a stable input object/array, so deck.gl
 * layer `data` keeps the SAME identity while the user pans at a constant LOD
 * tier — no attribute re-uploads per move-frame. Keyed on input reference.
 */
const derivedCache = new WeakMap<object, Map<string, unknown>>();

export function memoByTier<T extends object, R>(
  input: T,
  tier: LodTier,
  extraKey: string,
  build: (input: T, tier: LodTier) => R
): R {
  let entry = derivedCache.get(input);
  if (!entry) {
    entry = new Map();
    derivedCache.set(input, entry);
  }
  const key = `${tier}|${extraKey}`;
  if (entry.has(key)) return entry.get(key) as R;
  const out = build(input, tier);
  entry.set(key, out);
  return out;
}
