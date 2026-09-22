import { XMLParser } from "fast-xml-parser";
import type { FeedHealth, GeoPoint, LiveAlert } from "./types";
import { hazardFrom, normalizeCertainty, normalizeSeverity, normalizeUrgency } from "./severity";

// IMD's own district-bulletin CAP feed — a different product from the
// nowcasts SACHET carries (bulletin-level vs. short-range nowcast), so both
// are worth keeping. These documents do carry a warned-area polygon, and it
// is the only trustworthy geometry here: observed feed documents have had an
// areaDesc naming one state while the polygon covered another, so the text is
// used strictly as a fallback when no polygon is published.
const RSS_URL = "https://cap-sources.s3.amazonaws.com/in-imd-en/rss.xml";
const MAX_ITEMS = 30;
const REFRESH_SECONDS = 300;

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
const list = <T>(x: T | T[] | undefined | null): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
const text = (x: unknown) => (x && typeof x === "object" && "#text" in x ? String((x as any)["#text"]) : String(x ?? ""));

function isoOrNull(s: string): string | null {
  const v = String(s ?? "").trim();
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// CAP polygons are "lat,lng lat,lng ..." space-separated, first point repeated
// at the end to close the ring.
function parsePolygon(raw: string): GeoPoint[] {
  const pts: GeoPoint[] = [];
  for (const pair of String(raw ?? "").trim().split(/\s+/)) {
    const [a, b] = pair.split(",");
    const lat = Number(a);
    const lng = Number(b);
    if (Number.isFinite(lat) && Number.isFinite(lng)) pts.push({ lat, lng });
  }
  return pts.length >= 3 ? pts : [];
}

async function fetchText(url: string) {
  const res = await fetch(url, { next: { revalidate: REFRESH_SECONDS }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.text();
}

type Parsed = { alert: LiveAlert | null; skipped: boolean };

async function itemToAlert(item: any): Promise<Parsed> {
  const title = text(item.title);
  // Until the linked CAP document is read we know almost nothing. Mark it
  // degraded so a failed sub-fetch can't masquerade as a confident Moderate.
  const alert: LiveAlert = {
    id: `imd-${text(item.guid) || text(item.link) || title}`,
    hazard_type: hazardFrom(title),
    severity: "Moderate",
    source_agency: "IMD",
    area_text: text(item.description),
    headline: title,
    timestamp: isoOrNull(text(item.pubDate)) ?? new Date().toISOString(),
    onset: null,
    expires: null,
    lat: null,
    lng: null,
    radius_km: null,
    polygons: [],
    urgency: "Unknown",
    certainty: "Unknown",
    instruction: null,
    description: null,
    degraded: true,
  };
  if (!item.link) return { alert, skipped: false };

  try {
    const cap = parser.parse(await fetchText(text(item.link)))?.alert;
    if (!cap) return { alert, skipped: false };

    // Only real, current alerts. A drill or a system test must never render
    // as an emergency, and a cancellation must remove the alert rather than
    // sit alongside it looking live.
    const status = text(cap.status).trim().toLowerCase();
    const msgType = text(cap.msgType).trim().toLowerCase();
    if (status && status !== "actual") return { alert: null, skipped: true };
    if (msgType === "cancel" || msgType === "ack" || msgType === "error") return { alert: null, skipped: true };

    const infos = list<any>(cap.info);
    const info = infos.find((i) => text(i.language || "en").toLowerCase().startsWith("en")) ?? infos[0];
    if (!info) return { alert, skipped: false };

    const expires = isoOrNull(text(info.expires));
    if (expires && new Date(expires).getTime() < Date.now()) return { alert: null, skipped: true };

    const { severity, known } = normalizeSeverity(info.severity);
    alert.severity = severity;
    alert.urgency = normalizeUrgency(info.urgency);
    alert.certainty = normalizeCertainty(info.certainty);
    alert.hazard_type = hazardFrom(`${text(info.event)} ${text(info.headline)} ${text(info.description)}`);
    alert.headline = text(info.headline) || text(info.event) || title;
    alert.description = text(info.description) || null;
    alert.instruction = text(info.instruction).replace(/\s+/g, " ").trim() || null;
    alert.onset = isoOrNull(text(info.onset)) ?? isoOrNull(text(info.effective));
    alert.expires = expires;
    if (cap.sent) alert.timestamp = isoOrNull(text(cap.sent)) ?? alert.timestamp;

    const areas = list<any>(info.area);
    const descs = areas.map((a) => text(a.areaDesc)).filter(Boolean);
    if (descs.length) alert.area_text = descs.join(", ");
    for (const a of areas) {
      for (const poly of list<any>(a.polygon)) {
        const ring = parsePolygon(text(poly));
        if (ring.length) alert.polygons.push(ring);
      }
    }

    alert.degraded = !known;
    return { alert, skipped: false };
  } catch {
    // Keep the RSS-level fields, still flagged degraded.
    return { alert, skipped: false };
  }
}

export async function fetchImdAlerts(): Promise<FeedHealth & { alerts: LiveAlert[] }> {
  try {
    const rss = parser.parse(await fetchText(RSS_URL));
    const items = list<any>(rss?.rss?.channel?.item).slice(0, MAX_ITEMS);
    const parsed = await Promise.all(items.map(itemToAlert));
    const alerts = parsed.map((p) => p.alert).filter((a): a is LiveAlert => a !== null);

    // An empty result after filtering is a normal, healthy outcome — expired
    // and cancelled alerts are supposed to disappear. Reaching the feed at all
    // is what "ok" means; it must not be conflated with "has something to say".
    return {
      ok: true,
      degraded: items.length > 0 && parsed.every((p) => p.alert?.degraded),
      received: items.length,
      usable: alerts.length,
      alerts,
    };
  } catch (err) {
    console.error("[IMD] feed unavailable:", err);
    return { ok: false, degraded: false, received: 0, usable: 0, note: String(err), alerts: [] };
  }
}
