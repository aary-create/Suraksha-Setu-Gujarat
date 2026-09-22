export type Severity = "Extreme" | "Severe" | "Moderate" | "Minor";

// CAP 1.2 qualifiers. Severity alone can't tell you whether to act now — an
// "Extreme / Future / Possible" cyclone and an "Extreme / Immediate /
// Observed" one need very different responses.
export type Urgency = "Immediate" | "Expected" | "Future" | "Past" | "Unknown";
export type Certainty = "Observed" | "Likely" | "Possible" | "Unlikely" | "Unknown";

export type GeoPoint = { lat: number; lng: number };

export type Location = {
  label: string;   // what the person searched or the reverse-geocoded address
  lat: number;
  lng: number;
  district: string; // best-effort, from geocoding — used as a text fallback match
  state: string;
};

export type LiveAlert = {
  id: string;
  hazard_type: string;
  severity: Severity;
  source_agency: string;
  area_text: string;
  headline: string;
  timestamp: string; // ISO — when the alert became effective
  onset: string | null; // ISO — when the hazard itself is expected to begin
  expires: string | null; // ISO — after this the alert is no longer valid
  lat: number | null;
  lng: number | null;
  radius_km: number | null; // derived from the source's reported area, null if unknown
  // Authoritative warned area when the source publishes one. A polygon always
  // beats the centroid+radius circle and beats the area text, both of which
  // are approximations (and the text is sometimes simply wrong).
  polygons: GeoPoint[][];
  urgency: Urgency;
  certainty: Certainty;
  // The issuing agency's own guidance, when it publishes any. Official wording
  // outranks anything this app would generate for the same hazard.
  instruction: string | null;
  description: string | null;
  // True when the source document couldn't be fully parsed, so fields fell
  // back to defaults. Never let a degraded parse read as a confident low
  // severity — the UI flags it instead.
  degraded: boolean;
};

// Why a feed's result should or shouldn't be trusted this cycle.
export type FeedHealth = {
  ok: boolean;
  received: number; // records the feed returned
  usable: number; // records that survived parsing + validity filtering
  degraded: boolean; // feed answered, but the shape looks wrong
  note?: string;
};

export type Profile = Location & {
  dwelling_type: string;
  occupation: string;
  vulnerabilities: string[];
  language: string;
};

export type HelpPlace = {
  name: string;
  lat: number;
  lng: number;
  place_id: string;
  phone?: string;
  distance_km: number;
};
