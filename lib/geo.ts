import type { GeoPoint } from "./types";

// Straight-line distance in km between two lat/lng points.
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Ray casting. A warned area from CAP is a plain lat/lng ring, small enough
// (a few hundred km) that treating it as planar costs far less accuracy than
// the circle-from-area approximation it replaces.
export function pointInPolygon(p: GeoPoint, ring: GeoPoint[]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const straddles = a.lat > p.lat !== b.lat > p.lat;
    if (!straddles) continue;
    const x = ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (p.lng < x) inside = !inside;
  }
  return inside;
}

export function pointInAnyPolygon(p: GeoPoint, rings: GeoPoint[][]): boolean {
  return rings.some((r) => pointInPolygon(p, r));
}

// How far outside the warned area a point sits, in km — 0 when inside.
// Used to widen a polygon by a small tolerance rather than treating the ring
// as infinitely precise, since published rings are coarse.
export function kmOutsidePolygons(p: GeoPoint, rings: GeoPoint[][]): number {
  if (!rings.length) return Infinity;
  if (pointInAnyPolygon(p, rings)) return 0;
  let best = Infinity;
  for (const ring of rings) {
    for (const v of ring) best = Math.min(best, haversineKm(p, v));
  }
  return best;
}
