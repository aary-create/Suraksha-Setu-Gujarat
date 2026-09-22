import type { FeedHealth, LiveAlert } from "./types";
import { hazardFrom, normalizeCertainty, severityFromColor } from "./severity";

// SACHET (sachet.ndma.gov.in) is NDMA's national alert aggregator: IMD, CWC and
// every state SDMA publish into it. This endpoint is public, keyless JSON, no
// CAP-XML parsing needed — it already gives lat/lng ("centroid") and the
// warned area in km², which is what lets the app match "is this alert near
// this exact point" instead of matching by a fixed list of district names.
// HTTPS is required, not optional: this is a safety feed, and over plain HTTP
// anything on the network path can inject or suppress alerts.
const URL = "https://sachet.ndma.gov.in/cap_public_website/FetchAllAlertDetails";
const REFRESH_SECONDS = 120;

// Java Date#toString format: "Sat Sep 19 17:35:00 IST 2026". IST has no
// reliable cross-runtime parse, so read the fields and apply the +05:30 offset.
const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function parseIst(s: unknown): string | null {
  const m = /^\w+ (\w+) (\d+) (\d+):(\d+):(\d+) IST (\d+)$/.exec(String(s ?? ""));
  if (!m) return null;
  const [, mon, day, hh, mm, ss, year] = m;
  const ms = Date.UTC(+year, MONTHS[mon] ?? 0, +day, +hh, +mm, +ss) - (5 * 60 + 30) * 60_000;
  return new Date(ms).toISOString();
}

// "lng,lat" per the API's own samples (India's lng ~68-97, lat ~8-37 — the
// first number is always in the lng range), not GeoJSON's usual [lng,lat] array.
function parseCentroid(s: unknown): { lat: number; lng: number } | null {
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const lng = Number(m[1]);
  const lat = Number(m[2]);
  // Reject anything outside India's bounding box rather than trusting a
  // number that parsed but can't be a real location for this feed.
  if (lat < 6 || lat > 38 || lng < 67 || lng > 98) return null;
  return { lat, lng };
}

// A circle of this area, in km — used as the "is this alert local to you" radius.
function radiusFromArea(sqKm: unknown): number | null {
  const a = Number(sqKm);
  return Number.isFinite(a) && a > 0 ? Math.sqrt(a / Math.PI) : null;
}

export async function fetchSachetAlerts(): Promise<FeedHealth & { alerts: LiveAlert[] }> {
  try {
    const res = await fetch(URL, { next: { revalidate: REFRESH_SECONDS }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`SACHET returned ${res.status}`);
    const rows = (await res.json()) as any[];
    if (!Array.isArray(rows)) throw new Error("SACHET payload was not an array");

    const now = Date.now();
    let recognisedSeverities = 0;
    const alerts: LiveAlert[] = [];

    for (const r of rows) {
      // Not yet pushed out by the issuing authority — it exists in the feed
      // but hasn't been officially disseminated, so it isn't public guidance.
      if (String(r.disseminated ?? "").toLowerCase() === "false") continue;

      const startedAt = parseIst(r.effective_start_time);
      const endsAt = parseIst(r.effective_end_time);
      // Windows here can be as short as an hour (lightning nowcasts). An
      // expired alert must never render as current.
      if (endsAt && new Date(endsAt).getTime() < now) continue;

      const { severity, known } = severityFromColor(r.severity_color);
      if (known) recognisedSeverities++;
      const c = parseCentroid(r.centroid);
      const disasterType = String(r.disaster_type ?? "").trim();
      const message = String(r.warning_message ?? "").trim();

      alerts.push({
        id: `sachet-${r.identifier}`,
        hazard_type: hazardFrom(disasterType || message),
        severity,
        source_agency: String(r.alert_source ?? "SACHET"),
        area_text: String(r.area_description ?? ""),
        headline: disasterType || "Alert",
        timestamp: startedAt ?? new Date().toISOString(),
        onset: startedAt,
        expires: endsAt,
        lat: c?.lat ?? null,
        lng: c?.lng ?? null,
        radius_km: radiusFromArea(r.area_covered),
        polygons: [],
        // SACHET has no CAP urgency field; an alert inside its effective
        // window is by definition current, which is "Expected" at minimum.
        urgency: startedAt && new Date(startedAt).getTime() <= now ? "Immediate" : "Expected",
        certainty: normalizeCertainty(r.severity_level),
        // SACHET's warning_message describes what is forecast and where
        // ("...very likely over Amreli, Bharuch, ..."), it does not tell
        // anyone what to do. It is context, never the action — only CAP's
        // dedicated <instruction> field earns that slot.
        instruction: null,
        description: message || null,
        degraded: !known,
      });
    }

    // The feed answered with rows but nothing recognisable came out of them —
    // the shape has probably changed. Report that rather than letting an empty
    // result read to the user as "you are safe".
    const degraded = rows.length > 0 && (alerts.length === 0 || recognisedSeverities === 0);
    return {
      ok: true,
      degraded,
      received: rows.length,
      usable: alerts.length,
      note: degraded ? "SACHET returned records but none parsed as valid alerts" : undefined,
      alerts,
    };
  } catch (err) {
    console.error("[SACHET] feed unavailable:", err);
    return { ok: false, degraded: false, received: 0, usable: 0, note: String(err), alerts: [] };
  }
}
