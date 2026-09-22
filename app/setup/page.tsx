"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Crosshair, Search } from "@/components/Icon";
import { LANGUAGES, makeT } from "@/lib/i18n";
import { DWELLINGS, OCCUPATIONS, VULNERABILITIES, loadProfile, saveProfile } from "@/lib/options";
import type { Location, Profile } from "@/lib/types";

const EMPTY: Profile = {
  label: "", lat: NaN, lng: NaN, district: "", state: "",
  dwelling_type: "", occupation: "", vulnerabilities: [], language: "en",
};

// Two steps, not one long form. Step 1 is the only thing the app actually
// needs to start warning someone, so it stands alone and finishes in a tap;
// step 2 only sharpens the advice and can be skipped entirely.
type Step = "place" | "about";

export default function Setup() {
  const router = useRouter();
  const [p, setP] = useState<Profile>(EMPTY);
  const [step, setStep] = useState<Step>("place");
  const [locating, setLocating] = useState(false);
  const [locErr, setLocErr] = useState<"" | "noGeo" | "locOff">("");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Location[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [browse, setBrowse] = useState(false);
  const [districts, setDistricts] = useState<string[]>([]);
  const [talukas, setTalukas] = useState<string[]>([]);
  const [villages, setVillages] = useState<string[]>([]);
  const [selDistrict, setSelDistrict] = useState("");
  const [selTaluka, setSelTaluka] = useState("");
  const [resolving, setResolving] = useState(false);
  const skipNext = useRef(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const t = makeT(p.language);
  const hasPlace = !!p.label && Number.isFinite(p.lat);

  useEffect(() => {
    const saved = loadProfile();
    if (saved) {
      setP(saved);
      setQuery(saved.label ?? "");
      skipNext.current = true;
    }
  }, []);

  useEffect(() => { document.documentElement.lang = p.language; }, [p.language]);

  function apply(g: Location) {
    setLocErr("");
    setSuggestions([]);
    skipNext.current = true;
    setQuery(g.label);
    setP((prev) => ({ ...prev, label: g.label, lat: g.lat, lng: g.lng, district: g.district, state: g.state }));
  }

  function detect() {
    if (!navigator.geolocation) return setLocErr("noGeo");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        try {
          const d = await (await fetch(`/api/geocode/reverse?lat=${lat}&lng=${lng}`)).json();
          apply(d.result);
        } catch {
          apply({ label: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng, district: "", state: "" });
        } finally {
          setLocating(false);
        }
      },
      () => { setLocating(false); setLocErr("locOff"); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // Ask once on open, the way SACHET's own app does — the fastest path to a
  // real answer is the one that needs no taps at all.
  useEffect(() => {
    if (!loadProfile()) detect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (skipNext.current) { skipNext.current = false; return; }
    if (debounce.current) clearTimeout(debounce.current);
    if (query.trim().length < 3) { setSuggestions([]); return; }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const d = await (await fetch(`/api/geocode/search?q=${encodeURIComponent(query)}`)).json();
        setSuggestions(d.results ?? []);
      } catch { setSuggestions([]); }
      finally { setSearching(false); }
    }, 350);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query]);

  // The government village directory has no coordinates of its own, so a
  // picked place is resolved through the same geocoder a typed search uses.
  useEffect(() => {
    if (!browse || districts.length) return;
    fetch("/api/gujarat").then((r) => r.json()).then((d) => setDistricts(d.districts ?? [])).catch(() => {});
  }, [browse, districts.length]);

  function pickDistrict(d: string) {
    setSelDistrict(d);
    setSelTaluka("");
    setTalukas([]);
    setVillages([]);
    if (!d) return;
    fetch(`/api/gujarat?district=${encodeURIComponent(d)}`)
      .then((r) => r.json()).then((r) => setTalukas(r.talukas ?? [])).catch(() => {});
  }

  function pickTaluka(tal: string) {
    setSelTaluka(tal);
    setVillages([]);
    if (!tal) return;
    fetch(`/api/gujarat?district=${encodeURIComponent(selDistrict)}&taluka=${encodeURIComponent(tal)}`)
      .then((r) => r.json()).then((r) => setVillages(r.villages ?? [])).catch(() => {});
  }

  async function resolvePick(village: string | null) {
    const parts = [village, selTaluka, selDistrict, "Gujarat", "India"].filter(Boolean);
    setResolving(true);
    try {
      const d = await (await fetch(`/api/geocode/search?q=${encodeURIComponent(parts.join(", "))}`)).json();
      if (d.results?.[0]) { apply(d.results[0]); setBrowse(false); }
    } catch {
      // the picked names stay on screen; the user can still search instead
    } finally {
      setResolving(false);
    }
  }

  const set = (k: keyof Profile, v: unknown) => setP((prev) => ({ ...prev, [k]: v }));
  const toggleVuln = (id: string) =>
    set("vulnerabilities", p.vulnerabilities.includes(id) ? p.vulnerabilities.filter((v) => v !== id) : [...p.vulnerabilities, id]);

  function finish() {
    setSaving(true);
    saveProfile(p);
    // Fire and forget: the app already works from local state, so a failed
    // save must never stand between someone and their alert.
    fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    }).catch(() => {});
    router.push("/");
  }

  if (step === "about") {
    return (
      <main>
        <p className="eyebrow">{t("stepTwoOfTwo")}</p>
        <h1>{t("tuneTitle")}</h1>
        <p className="muted" style={{ marginTop: 8 }}>{t("tuneSub")}</p>

        <label className="field-label">{t("homeQ")}</label>
        <div className="pick">
          {DWELLINGS.map((id) => (
            <label key={id}>
              <input type="radio" name="dwelling" checked={p.dwelling_type === id} onChange={() => set("dwelling_type", id)} />
              {t(`d_${id}`)}
            </label>
          ))}
        </div>

        <label className="field-label">{t("youQ")}</label>
        <div className="pick">
          {OCCUPATIONS.map((id) => (
            <label key={id}>
              <input type="radio" name="occupation" checked={p.occupation === id} onChange={() => set("occupation", id)} />
              {t(`o_${id}`)}
            </label>
          ))}
        </div>

        <label className="field-label">{t("careQ")}</label>
        <div className="pick">
          {VULNERABILITIES.map((id) => (
            <label key={id}>
              <input type="checkbox" checked={p.vulnerabilities.includes(id)} onChange={() => toggleVuln(id)} />
              {t(`v_${id}`)}
            </label>
          ))}
        </div>

        <div style={{ marginTop: 30 }}>
          <button className="btn block" disabled={saving} onClick={finish}>
            {saving ? t("saving") : t("seeMyAlerts")}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main>
      <p className="eyebrow">{t("stepOneOfTwo")}</p>
      <h1>{t("locationQ")}</h1>
      <p className="muted" style={{ marginTop: 8 }}>{t("locationWhy")}</p>

      <div style={{ marginTop: 26 }}>
        <button type="button" className="btn block" onClick={detect} disabled={locating}>
          <Crosshair size={19} />
          {locating ? t("locating") : t("useMyLocation")}
        </button>
      </div>

      <label className="field-label" htmlFor="place">{t("orSearch")}</label>
      <div className="search-wrap">
        <input
          id="place"
          type="text"
          value={query}
          placeholder={t("searchPlaceholder")}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setP((prev) => ({ ...prev, label: e.target.value, lat: NaN, lng: NaN }));
          }}
        />
        {suggestions.length > 0 && (
          <ul className="suggestions">
            {suggestions.map((s, i) => (
              <li key={i}>
                <button type="button" onClick={() => apply(s)}>{s.label}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {searching && <p className="muted small" style={{ marginTop: 8 }}><Search size={14} /> {t("locating")}</p>}
      {locErr && <p className="banner" style={{ marginTop: 12 }}>{t(locErr)}</p>}

      {/* Many Gujarat villages don't surface well in a free-text geocoder, so
          the official district → taluka → village list is always available. */}
      {!browse ? (
        <button type="button" className="link-btn" style={{ marginTop: 12 }} onClick={() => setBrowse(true)}>
          {t("browseGujarat")}
        </button>
      ) : (
        <div style={{ display: "grid", gap: 9, marginTop: 14 }}>
          <select value={selDistrict} onChange={(e) => pickDistrict(e.target.value)}>
            <option value="">{t("selectDistrict")}</option>
            {districts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          {selDistrict && (
            <select value={selTaluka} onChange={(e) => pickTaluka(e.target.value)}>
              <option value="">{t("selectTaluka")}</option>
              {talukas.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          )}
          {selTaluka && (
            <select defaultValue="" onChange={(e) => e.target.value && resolvePick(e.target.value)}>
              <option value="">{t("selectVillage")}</option>
              {villages.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
          {selTaluka && (
            <button type="button" className="link-btn" onClick={() => resolvePick(null)} disabled={resolving}>
              {resolving ? t("locating") : t("useTalukaCenter")}
            </button>
          )}
          <button type="button" className="link-btn" onClick={() => setBrowse(false)}>{t("searchInstead")}</button>
        </div>
      )}

      {hasPlace && <p className="chip" style={{ marginTop: 16 }}>📍 {p.label}</p>}

      <label className="field-label" htmlFor="lang">{t("language")}</label>
      <select id="lang" value={p.language} onChange={(e) => set("language", e.target.value)}>
        {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>

      <div style={{ marginTop: 30 }}>
        <button className="btn block" disabled={!hasPlace} onClick={() => setStep("about")}>
          {t("continue")}
        </button>
        {hasPlace && (
          <button type="button" className="link-btn" style={{ marginTop: 14, width: "100%" }} onClick={finish}>
            {t("skipForNow")}
          </button>
        )}
      </div>
    </main>
  );
}
