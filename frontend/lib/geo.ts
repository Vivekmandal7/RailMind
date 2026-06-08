import type { LngLat } from "./types";

const R = 6371; // km

export function haversineKm(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(a[0] - b[0]) * -1;
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Total length of a polyline in km plus the cumulative distance per vertex. */
export function polylineCum(coords: LngLat[]): { total: number; cum: number[] } {
  const cum: number[] = [0];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineKm(coords[i - 1], coords[i]);
    cum.push(total);
  }
  return { total, cum };
}

/** Interpolate a position at distance `d` km along a polyline. Returns position + bearing. */
export function interpAlong(
  coords: LngLat[],
  cum: number[],
  d: number
): { pos: LngLat; bearing: number } {
  if (d <= 0) return { pos: coords[0], bearing: bearingBetween(coords[0], coords[1] ?? coords[0]) };
  const last = cum[cum.length - 1];
  if (d >= last)
    return {
      pos: coords[coords.length - 1],
      bearing: bearingBetween(coords[coords.length - 2] ?? coords[0], coords[coords.length - 1])
    };
  // binary-ish linear search
  let i = 1;
  while (i < cum.length && cum[i] < d) i++;
  const segStart = cum[i - 1];
  const segEnd = cum[i];
  const t = segEnd === segStart ? 0 : (d - segStart) / (segEnd - segStart);
  const a = coords[i - 1];
  const b = coords[i];
  const pos: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return { pos, bearing: bearingBetween(a, b) };
}

export function bearingBetween(a: LngLat, b: LngLat): number {
  const y = Math.sin(toRad(b[0] - a[0])) * Math.cos(toRad(b[1]));
  const x =
    Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) -
    Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(toRad(b[0] - a[0]));
  return (Math.atan2(y, x) * 180) / Math.PI;
}

export function fmtClock(sec: number): string {
  const s = ((sec % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function fmtClockS(sec: number): string {
  const s = ((sec % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function parseHHMM(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 3600 + m * 60;
}
