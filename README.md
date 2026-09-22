# Suraksha Setu — Gujarat

Personalised disaster alerts for India, built on free public data end to
end, with deep Gujarat coverage: every one of the state's 33 districts,
270 talukas and 18,651 inhabited villages, sourced from India's actual
Local Government Directory (Ministry of Panchayati Raj), not typed by
hand. Real alerts, real hospitals, real precautions — nothing in this app
is sample or invented data.

Pages: `/` (alert), `/setup`, `/help`, `/history`
APIs: `/api/dashboard`, `/api/users`, `/api/gujarat`, `/api/esp32-sync`, `/api/geocode/search`, `/api/geocode/reverse`, `/api/hospitals`, `/api/explain`, `/api/push/subscribe`, `/api/cron/check-alerts`

## What this version adds

- **Every Gujarat village, for real.** Onboarding now has a "Browse Gujarat by district" option alongside search: district → taluka → village, all 18,651 of them, pulled from the government's own LGD registry (`data/gujarat-places.json`, ~210KB, loaded server-side only). Free-text search still covers the rest of India as before.
- **Location-first, like SACHET's own app.** Onboarding asks for your GPS position immediately on open instead of waiting for a tap — falls back cleanly to search or the Gujarat browser if you decline or it's unavailable.
- **A real animation pass.** Fade-ins, staggered lists, a pulse/glow on Extreme and Severe alerts, skeleton loaders instead of "Loading…" text, button press feedback, animated map markers — all wrapped in a `prefers-reduced-motion` guard, so none of it runs for anyone who's turned that off.
- **Full precautions, not just one line.** Every hazard now has genuine before-it-arrives and after-it-passes guidance (`hazard_guide` in `data/seed.json`), on top of the existing during-the-event action text — expandable on the dashboard.
- **A plain-language glossary.** Tapping "Explain this alert simply" instantly expands jargon like IMD, SACHET, "orange alert" — rule-based, offline-capable, zero cost, can't misstate a safety fact.
- **Optional AI explanation, free by default, cached for offline reuse.** With a `GROQ_API_KEY` set (free, no credit card — sign up at console.groq.com), the "Explain this alert simply" button also gets a one-time AI rewrite of the alert's own headline into plain language — fetched once per alert, then cached on-device for 5 days, so a second look (even offline) doesn't need a fresh call. `ANTHROPIC_API_KEY` works too, as a paid, higher-quality opt-in if you'd rather use Claude — Groq is used by default if both are set. Without either key, this part is skipped silently and the glossary still works.
- **A 5-day severity timeline and personal stats**, built entirely from the local on-device history — a visual, proportional-by-time chart on the Offline tab, plus a breakdown of your own alerts by hazard type.
- **Auto-read-aloud for new severe alerts.** When a new Extreme or Severe alert arrives, it's read aloud automatically (mute toggle provided) — on top of the existing on-demand "Read aloud" button.
- **Feed and community reports removed** — this version is scoped to personal alerts and precautions only, no nationwide feed or user-submitted reports.
- Fixed a handful of real inconsistencies found in a full line-by-line review: a stale theme color left over from before the redesign, stale "Google Maps" copy in all 5 languages left over from the OpenStreetMap migration, the bottom nav's CSS still assuming 4 tabs after Feed was removed, and repeated work being redone on every request instead of once at startup.

## How an alert is judged safe to show

Alerting is only useful if a quiet screen genuinely means "nothing is
wrong". These are the rules the pipeline enforces before anything reaches
a person:

- **Both feeds are fetched over HTTPS.** A warning delivered over plain
  HTTP can be altered or suppressed by anything on the network path.
- **Expired alerts are dropped**, on parse and again at request time.
  SACHET windows can be as short as an hour, and CAP `expires` is
  authoritative. Observed in the live feed: IMD bulletins still listed
  days after they expired.
- **Only `status: Actual` is shown.** Drills, exercises and system tests
  are discarded rather than rendered as emergencies, and a `msgType:
  Cancel` removes an alert instead of sitting beside it.
- **Undisseminated SACHET records are skipped** — roughly a third of the
  feed at any time is not yet officially released.
- **A published polygon always wins.** Centroid-plus-radius is a circle
  drawn over an irregular warned area, and the area *text* has been seen
  naming the wrong state entirely for a polygon covering somewhere else.
  Text matching is the last resort, and it matches whole words against a
  transliteration alias table so "Kutch" and "Kachchh" are the same place.
- **Failures never quietly downgrade severity.** An unrecognised value
  marks the alert `degraded` and the UI says so, instead of defaulting to
  "Moderate" and looking confident.
- **"We could not check" is never rendered as "you are safe."** The API
  returns `canVouch`, and the screen says plainly when it can't stand
  behind what it's showing.

## Run on your laptop

Needs Node 20 or newer.

```bash
npm install
cp .env.example .env.local     # optional — see below
npm run dev                    # open http://localhost:3000
```

## Deploy to Vercel

1. Push this folder to a GitHub repo, then on vercel.com: Add New → Project → import the repo → Deploy. Alerts, location, search, hospitals and the Gujarat browser all work immediately with no key to create.
2. **Database (optional):** Vercel → Storage → Create Database → Neon → Connect to project. Tables are created automatically on first request. Without it, users still onboard fine, the data just doesn't persist between server restarts.
3. **AI explanation (optional, free):** Vercel → Settings → Environment Variables → add `GROQ_API_KEY` from console.groq.com — free, no credit card. Without it, "Explain this alert simply" still works via the built-in glossary, it just won't have the AI-rewritten version.
4. Test the live feeds: open `https://YOUR-APP.vercel.app/api/dashboard?lat=23.03&lng=72.58&district=Ahmedabad&state=Gujarat` — `canVouch` should be `true`, and `feeds.sachet.ok` / `feeds.imd.ok` should both be `true`.

## ESP32

`firmware/suraksha_setu_node.ino` is the complete, ready-to-flash sketch — WiFi AP + home WiFi, ESP-NOW mesh relay, LittleFS-backed alert cache, a 5-day on-device history log, and a local web server phones can read offline at `192.168.4.1`. Edit the `CONFIG` block at the top (node id, this board's lat/lng, WiFi credentials, and `SYNC_URL` set to your Vercel URL), install the ArduinoJson library, pick a partition scheme with LittleFS, and upload.

## Editing content

- Safety steps, before/after precautions, and helpline numbers: `data/seed.json`.
- Translations: `data/translations.json`.
- All interface text: `lib/i18n.ts`.
- Gujarat's district/taluka/village data: `data/gujarat-places.json` — regenerate from a fresh LGD export if you want to update it; see `lib/gujarat.ts` for how it's read.

## Known limits

- **Translation coverage is partial.** Onboarding, the alert screen, and core safety steps are translated into Hindi, Gujarati, Tamil and Assamese. Occupation tips, the new before/after precaution guide, and the AI/glossary explanations are English-only for now — falls back to English automatically, never shows blank. None of the translations have had native-speaker review; get them checked before real use, since they're safety instructions.
- **Village-level data has no coordinates of its own** — the LGD directory lists names, not lat/lng, so picking a village resolves its position through the same Nominatim search used for free-text — occasionally a very small or newly-named village won't resolve, in which case its taluka's location is used instead.
- **Nominatim is rate-limited to 1 request/second** and isn't meant for heavy/bulk use.
- **OpenStreetMap's tile server asks that production apps not hotlink it at real scale** — fine for a project at this size; a larger deployment should move to a dedicated tile provider.
- **AI explanations are cached per alert per device, not shared** — two people looking at the same alert on two phones each trigger one call the first time they open it.
- Notifications and auto-read-aloud fire only while the app is open or backgrounded in a tab, not to a fully closed app — that needs Web Push, which isn't built.
- ESP32 node status lives in memory without a database, and resets when Vercel restarts the server instance.
