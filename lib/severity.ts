import type { Certainty, LiveAlert, Severity, Urgency } from "./types";

export const SEVERITY_RANK: Record<Severity, number> = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1 };
const URGENCY_RANK: Record<Urgency, number> = { Immediate: 4, Expected: 3, Future: 2, Unknown: 1, Past: 0 };
const CERTAINTY_RANK: Record<Certainty, number> = { Observed: 4, Likely: 3, Possible: 2, Unknown: 1, Unlikely: 0 };

// SACHET's severity_color is the one field every source in the feed sets
// consistently. `known: false` marks a value we didn't recognise, so a feed
// schema change shows up as a flagged alert instead of a silent "Moderate".
export function severityFromColor(color: unknown): { severity: Severity; known: boolean } {
  switch (String(color ?? "").trim().toLowerCase()) {
    case "red": return { severity: "Extreme", known: true };
    case "orange": return { severity: "Severe", known: true };
    case "yellow": return { severity: "Moderate", known: true };
    case "green": return { severity: "Minor", known: true };
    default: return { severity: "Moderate", known: false };
  }
}

export function normalizeSeverity(s: unknown): { severity: Severity; known: boolean } {
  switch (String(s ?? "").trim().toLowerCase()) {
    case "extreme": return { severity: "Extreme", known: true };
    case "severe": return { severity: "Severe", known: true };
    case "moderate": return { severity: "Moderate", known: true };
    case "minor": return { severity: "Minor", known: true };
    default: return { severity: "Moderate", known: false };
  }
}

export function normalizeUrgency(s: unknown): Urgency {
  const v = String(s ?? "").trim().toLowerCase();
  if (v === "immediate") return "Immediate";
  if (v === "expected") return "Expected";
  if (v === "future") return "Future";
  if (v === "past") return "Past";
  return "Unknown";
}

export function normalizeCertainty(s: unknown): Certainty {
  const v = String(s ?? "").trim().toLowerCase();
  if (v === "observed") return "Observed";
  if (v === "likely") return "Likely";
  if (v === "possible") return "Possible";
  if (v === "unlikely") return "Unlikely";
  return "Unknown";
}

export const HAZARD_LABEL: Record<string, string> = {
  flood: "Flood",
  cyclone: "Cyclone",
  tsunami: "Tsunami",
  earthquake: "Earthquake",
  heavy_rain: "Heavy rain",
  thunderstorm: "Thunderstorm",
  heatwave: "Heatwave",
  coldwave: "Cold wave",
  dust_storm: "Dust storm",
  landslide: "Landslide",
  fire: "Fire",
  fog: "Dense fog",
  other: "Weather alert",
};

// SACHET and IMD both write disaster type as free text ("Moderate Thunderstorms
// with surface wind", "Very Heavy Rain", "Squally weather"...) — bucket it into
// the categories the app has precautions for. Ordered most-dangerous-first so a
// compound headline resolves to the hazard that needs the strongest response:
// "cyclone with heavy rain" must read as a cyclone, not as rain.
const HAZARD_PATTERNS: [RegExp, string][] = [
  [/tsunami/i, "tsunami"],
  [/earthquake|quake|seismic/i, "earthquake"],
  [/cyclon|hurricane|typhoon/i, "cyclone"],
  [/flood|inundat|deluge|cloud ?burst/i, "flood"],
  [/landslide|landslip|mudslide|rockfall/i, "landslide"],
  [/storm surge|high wave|swell|kallakkadal|rip current/i, "flood"],
  [/dust ?storm|sand ?storm|haboob/i, "dust_storm"],
  [/thunder|lightning|squall|hail/i, "thunderstorm"],
  [/heat ?wave|heatwave|warm night|hot weather/i, "heatwave"],
  [/cold ?wave|coldwave|cold day|frost|snow/i, "coldwave"],
  [/forest fire|wildfire|\bfire\b/i, "fire"],
  [/\bfog\b|mist|low visibility/i, "fog"],
  [/rain|precipitat|monsoon|shower/i, "heavy_rain"],
  [/wind|gale/i, "thunderstorm"],
];

export function hazardFrom(text: string): string {
  for (const [re, hazard] of HAZARD_PATTERNS) if (re.test(text)) return hazard;
  return "other";
}

// Severity always dominates so a more dangerous hazard can never be hidden by
// a nearer-term mild one; urgency then certainty break ties within a severity.
export function priorityScore(a: LiveAlert): number {
  return SEVERITY_RANK[a.severity] * 100 + URGENCY_RANK[a.urgency] * 10 + CERTAINTY_RANK[a.certainty];
}
