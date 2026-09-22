import { haversineKm } from "./geo";
import type { HelpPlace } from "./types";

// Overpass API — free, keyless queries against OpenStreetMap data.
// Proxied server-side to keep one consistent place to adjust the
// query/timeout, same pattern as the geocoding routes.
// The main Overpass instance is community-run and regularly sheds load with
// a 502/504. Since this list is what someone uses to find a hospital, one
// busy server must not be a single point of failure — try the mirrors in
// turn, still comfortably inside Vercel's function budget.
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const RADIUS_M = 15000; // 15km — 8km missed real, mapped facilities in a
// district-headquarters town; a single wider query beats a multi-step
// retry here, since Vercel's Hobby plan caps a function at 10s total and
// a sequence of retries can blow past that and fail the whole request.

// Matches both the classic amenity=hospital/clinic tagging and the newer,
// increasingly-used healthcare=hospital/clinic scheme — OSM contributors
// in smaller Indian towns often use one or the other, not always both, so
// matching only amenity=hospital was missing real, mapped facilities.
function buildQuery(lat: number, lng: number) {
  return `[out:json][timeout:8];(nwr["amenity"~"^(hospital|clinic)$"](around:${RADIUS_M},${lat},${lng});nwr["healthcare"~"^(hospital|clinic)$"](around:${RADIUS_M},${lat},${lng}););out center 30;`;
}

// Raced rather than tried in turn: these instances are community-run and any
// one of them can be slow or shedding load at any moment. Asking all of them
// at once costs the same wall-clock as the fastest healthy mirror, which is
// what keeps this inside a serverless time budget.
async function queryOverpass(lat: number, lng: number): Promise<any[]> {
  const body = `data=${encodeURIComponent(buildQuery(lat, lng))}`;
  const attempts = OVERPASS_URLS.map(async (url) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // Overpass answers 406 to a request that doesn't identify itself,
        // exactly like Nominatim — which is why this is proxied at all.
        "User-Agent": "SurakshaSetu/1.0 (disaster alert app; +https://github.com/aary-create/Suraksha-Setu-Gujarat)",
        Accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(8500),
    });
    if (!res.ok) throw new Error(`Overpass ${url} returned ${res.status}`);
    return ((await res.json()).elements ?? []) as any[];
  });
  try {
    return await Promise.any(attempts);
  } catch (err) {
    const reasons = err instanceof AggregateError ? err.errors.map(String).join("; ") : String(err);
    throw new Error(`every Overpass mirror failed: ${reasons}`);
  }
}

export async function nearbyHospitals(lat: number, lng: number): Promise<HelpPlace[]> {
  const elements = await queryOverpass(lat, lng);

  const seen = new Set<string>();
  const places: HelpPlace[] = [];
  for (const e of elements) {
    const elat = e.lat ?? e.center?.lat;
    const elng = e.lon ?? e.center?.lon;
    if (elat == null || elng == null) continue;
    const key = `${e.type}/${e.id}`;
    if (seen.has(key)) continue; // the two OR'd clauses can both match one element
    seen.add(key);
    const tags = e.tags ?? {};
    const name = tags.name || tags["name:en"] || (tags.amenity === "clinic" || tags.healthcare === "clinic" ? "Clinic" : "Hospital");
    const phone = tags.phone || tags["contact:phone"] || undefined;
    places.push({
      name, lat: elat, lng: elng, place_id: key, phone,
      distance_km: haversineKm({ lat, lng }, { lat: elat, lng: elng }),
    });
  }
  places.sort((a, b) => a.distance_km - b.distance_km);
  return places.slice(0, 10);
}
