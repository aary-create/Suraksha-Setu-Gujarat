import seed from "@/data/seed.json";
import translations from "@/data/translations.json";
import { sql } from "./db";
import { fetchSachetAlerts } from "./sachet";
import { fetchImdAlerts } from "./cap";
import { haversineKm, kmOutsidePolygons } from "./geo";
import { priorityScore } from "./severity";
import { placeMatchesArea } from "./places";
import type { FeedHealth, LiveAlert, Profile } from "./types";

export type FeedStatus = { sachet: FeedHealth; imd: FeedHealth };

// Live alerts from both real sources, merged. No invented/sample alerts —
// if both feeds are down, there simply are no live alerts.
export async function fetchLiveAlerts(): Promise<{ feeds: FeedStatus; alerts: LiveAlert[] }> {
  const [sachet, imd] = await Promise.all([fetchSachetAlerts(), fetchImdAlerts()]);
  const { alerts: sachetAlerts, ...sachetHealth } = sachet;
  const { alerts: imdAlerts, ...imdHealth } = imd;
  return { feeds: { sachet: sachetHealth, imd: imdHealth }, alerts: [...sachetAlerts, ...imdAlerts] };
}

// Published rings are coarse, so allow a small tolerance outside them rather
// than treating the boundary as exact.
const POLYGON_TOLERANCE_KM = 5;

// An alert "applies" to a point, in descending order of how much the source
// actually knows about its own warned area:
//   1. a published polygon — authoritative, and the only signal trusted when
//      present, because an areaDesc has been observed naming the wrong state
//      for a polygon that covered somewhere else entirely;
//   2. a centroid plus radius derived from the reported area;
//   3. the area text, matched on whole words with transliteration aliases.
export function alertsNear(alerts: LiveAlert[], lat: number, lng: number, district: string, state: string): LiveAlert[] {
  const here = { lat, lng };
  return alerts.filter((a) => {
    if (a.polygons.length) return kmOutsidePolygons(here, a.polygons) <= POLYGON_TOLERANCE_KM;
    if (a.lat != null && a.lng != null) {
      const radius = a.radius_km ?? 25;
      // Scale the imprecision buffer to the alert instead of always adding
      // 20km, which quintuples the reach of a small, tightly-drawn warning.
      const buffer = Math.min(20, Math.max(2, radius * 0.15));
      return haversineKm(here, { lat: a.lat, lng: a.lng }) <= radius + buffer;
    }
    return placeMatchesArea(a.area_text, district, state);
  });
}

// Defence in depth: the feed parsers already drop expired alerts, but the
// result is cached, so re-check against the clock at request time.
export function stillValid(a: LiveAlert, now = Date.now()): boolean {
  return !a.expires || new Date(a.expires).getTime() >= now;
}

// Highest-severity alert in scope, plus every agency reporting the same
// hazard type — if they disagree on severity, the higher one is shown and
// every agency is still listed.
export function currentAlert(alerts: LiveAlert[]) {
  alerts = alerts.filter((a) => stillValid(a));
  if (!alerts.length) return null;

  // A feed can carry both an older and a newer alert from the same agency
  // for the same hazard at once (an update that hasn't displaced the
  // original entry). Keeping the stale one could show a severity that's
  // already been downgraded, or register a false "disagreement" between
  // an agency and its own earlier alert — so only the newest per
  // agency+hazard counts from here on.
  const latestByAgencyHazard = new Map<string, LiveAlert>();
  for (const a of alerts) {
    const key = `${a.source_agency}|${a.hazard_type}`;
    const prev = latestByAgencyHazard.get(key);
    if (!prev || a.timestamp > prev.timestamp) latestByAgencyHazard.set(key, a);
  }
  const deduped = [...latestByAgencyHazard.values()];

  // Severity dominates, then urgency, then certainty, then recency — so a
  // hazard that's already being observed outranks an equally severe one that
  // is merely possible, without a milder hazard ever displacing a worse one.
  const top = deduped.sort(
    (a, b) => priorityScore(b) - priorityScore(a) || b.timestamp.localeCompare(a.timestamp)
  )[0];
  const sources = deduped
    .filter((a) => a.hazard_type === top.hazard_type)
    .map((a) => ({ agency: a.source_agency, severity: a.severity, headline: a.headline }));
  const conflict = new Set(sources.map((s) => s.severity)).size > 1;
  // Alerts for the same location but a different hazard type than the one
  // shown — kept separate from `conflict` (which is specifically about
  // severity disagreement within the same hazard) so neither loses information.
  const otherHazardSources = deduped
    .filter((a) => a.hazard_type !== top.hazard_type)
    .map((a) => ({ agency: a.source_agency, hazard_type: a.hazard_type, severity: a.severity, headline: a.headline }));
  return { alert: top, sources, conflict, otherHazardSources };
}

type DwellingRule = { dwelling_type: string; hazard_type: string; language: string; action_text: string };
type OccupationTip = { occupation: string; hazard_type: string; language: string; tip_text: string };

function seedDwellingRules(): DwellingRule[] {
  const tr = translations.dwelling_rules as Record<string, Record<string, string>>;
  return seed.dwelling_rules.flatMap((r) => [
    { ...r, language: "en" },
    ...Object.entries(tr[`${r.dwelling_type}|${r.hazard_type}`] ?? {}).map(([language, action_text]) => ({ ...r, language, action_text })),
  ]);
}
const DWELLING_RULES = seedDwellingRules(); // static reference data, computed once
const OCCUPATION_TIPS = seed.occupation_tips.map((t) => ({ ...t, language: "en" })) as OccupationTip[];

export async function actionFor(profile: Profile, hazard: string) {
  const { dwelling_type: d, occupation: o, language } = profile;

  let action = "";
  outer: for (const dd of [d, "*"]) {
    for (const lang of [language, "en"]) {
      const hit = DWELLING_RULES.find((r) => r.dwelling_type === dd && r.hazard_type === hazard && r.language === lang)
        ?? (dd === "*" && lang === "en" ? DWELLING_RULES.find((r) => r.dwelling_type === "*" && r.hazard_type === "*") : undefined);
      if (hit) { action = hit.action_text; break outer; }
    }
  }

  const occupationTip = OCCUPATION_TIPS.find((t) => t.occupation === o && t.hazard_type === hazard)
    ?? OCCUPATION_TIPS.find((t) => t.occupation === o && t.hazard_type === "*");

  const vulnTr = translations.vulnerability_tips as Record<string, Record<string, string>>;
  const vulnEn = seed.vulnerability_tips as Record<string, Record<string, string>>;
  const vulnerabilityTips = profile.vulnerabilities
    .map((v) => {
      const h = vulnEn[v]?.[hazard] ? hazard : "*";
      return vulnTr[`${v}|${h}`]?.[language] ?? vulnEn[v]?.[h];
    })
    .filter(Boolean) as string[];

  return { action, occupationTip: occupationTip?.tip_text ?? null, vulnerabilityTips };
}

export const helplines = seed.helplines;

const HAZARD_GUIDE = seed.hazard_guide as Record<string, { before: string[]; after: string[] }>;
export function hazardGuide(hazard: string) {
  return HAZARD_GUIDE[hazard] ?? null;
}

async function withDb<T>(run: (db: NonNullable<typeof sql>) => Promise<T>, fallback: () => T): Promise<T> {
  if (!sql) return fallback();
  try {
    return await run(sql);
  } catch (err) {
    console.error("[DB] query failed:", err);
    return fallback();
  }
}

export async function saveUser(p: Profile) {
  return withDb<{ saved: boolean }>(
    async (db) => {
      await db`insert into users (label, lat, lng, district, state, dwelling_type, occupation, vulnerabilities, language)
        values (${p.label}, ${p.lat}, ${p.lng}, ${p.district}, ${p.state}, ${p.dwelling_type}, ${p.occupation}, ${p.vulnerabilities}, ${p.language})`;
      return { saved: true };
    },
    () => ({ saved: false })
  );
}

// ESP32 nodes have a fixed physical location (set once in the firmware), so
// they report lat/lng directly rather than a district name.
type NodePing = { node_id: string; lat: number; lng: number; last_cached_ts: number | null; last_seen: string };
const memoryPings = new Map<string, NodePing>();

export async function recordPing(p: Omit<NodePing, "last_seen">) {
  memoryPings.set(p.node_id, { ...p, last_seen: new Date().toISOString() });
  await withDb<unknown>(
    (db) => db`insert into esp32_nodes (node_id, lat, lng, last_cached_ts, last_seen)
      values (${p.node_id}, ${p.lat}, ${p.lng}, ${p.last_cached_ts}, now())
      on conflict (node_id) do update set lat = excluded.lat, lng = excluded.lng,
        last_cached_ts = excluded.last_cached_ts, last_seen = now()`,
    () => null
  );
}

// The nearest node reporting from within 50km, if any.
export async function nearestNode(lat: number, lng: number): Promise<NodePing | null> {
  const fromMemory = () => {
    const near = [...memoryPings.values()].filter((n) => haversineKm({ lat, lng }, n) <= 50);
    return near.sort((a, b) => haversineKm({ lat, lng }, a) - haversineKm({ lat, lng }, b))[0] ?? null;
  };
  return withDb(async (db) => {
    const rows = (await db`select * from esp32_nodes`) as any[];
    const near = rows.filter((n) => haversineKm({ lat, lng }, n) <= 50);
    if (!near.length) return null;
    const closest = near.sort((a, b) => haversineKm({ lat, lng }, a) - haversineKm({ lat, lng }, b))[0];
    return { ...closest, last_cached_ts: closest.last_cached_ts == null ? null : Number(closest.last_cached_ts), last_seen: new Date(closest.last_seen).toISOString() };
  }, fromMemory);
}
