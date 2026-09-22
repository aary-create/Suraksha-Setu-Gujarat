// Matching a place name against an alert's free-text area is the weakest link
// in the pipeline: a naive `area.includes(district)` misses "Kachchh" when the
// geocoder said "Kutch", and fires on "Anand" inside "Anandpur". Both failures
// are silent, and the first one means a real warning never reaches someone.

// Indian district/state names carry many transliterations of the same place.
// Each row is one real place; any spelling in the row matches any other.
const ALIAS_GROUPS: string[][] = [
  ["kutch", "kachchh", "kachh", "kutchh", "bhuj"],
  ["banaskantha", "banas kantha", "palanpur"],
  ["sabarkantha", "sabar kantha", "himatnagar"],
  ["panchmahal", "panch mahals", "panchmahals", "godhra"],
  ["dahod", "dohad"],
  ["vadodara", "baroda"],
  ["mehsana", "mahesana"],
  ["junagadh", "junagarh"],
  ["jamnagar", "navanagar"],
  ["devbhumi dwarka", "dwarka", "devbhoomi dwarka"],
  ["chhota udepur", "chhotaudepur", "chhota udaipur"],
  ["mahisagar", "mahi sagar"],
  ["aravalli", "arvalli"],
  ["gir somnath", "girsomnath", "veraval"],
  ["surendranagar", "wadhwan"],
  ["ahmedabad", "ahmadabad", "amdavad"],
  ["surat", "suryapur"],
  ["the dangs", "dang", "dangs", "ahwa"],
  ["navsari", "nausari"],
  ["valsad", "bulsar"],
  ["porbandar", "sudamapuri"],
  ["saurashtra", "sorath"],
  ["odisha", "orissa"],
  ["puducherry", "pondicherry"],
  ["uttarakhand", "uttaranchal"],
  ["bengaluru", "bangalore"],
  ["mumbai", "bombay"],
  ["chennai", "madras"],
  ["kolkata", "calcutta"],
  ["thiruvananthapuram", "trivandrum"],
  ["varanasi", "banaras", "benares"],
  ["prayagraj", "allahabad"],
];

const ALIASES = new Map<string, string[]>();
for (const group of ALIAS_GROUPS) {
  for (const name of group) ALIASES.set(name, group);
}

// Drop the administrative suffixes geocoders append ("Ahmedabad District",
// "Kutch Taluka") so they don't defeat an otherwise exact match.
const NOISE = /\b(district|dist|taluka|tehsil|tahsil|division|sub[- ]division|city|rural|urban|region|state|zone)\b/g;

export function normalizePlace(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function variantsOf(name: string): string[] {
  const n = normalizePlace(name);
  if (!n) return [];
  return ALIASES.get(n) ?? [n];
}

// Whole-word containment, so "Anand" does not match "Anandpur" and "Dang"
// does not match "dangerous", while "North Gujarat" still matches "Gujarat".
function containsWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(haystack);
}

// True when `areaText` refers to this district or state, under any known
// spelling. District is the stronger signal; state alone is a broad match and
// callers should treat it as such.
export function placeMatchesArea(areaText: string, district: string, state: string): boolean {
  const hay = normalizePlace(areaText);
  if (!hay) return false;
  for (const name of [district, state]) {
    for (const v of variantsOf(name)) {
      if (containsWord(hay, v)) return true;
    }
  }
  return false;
}
