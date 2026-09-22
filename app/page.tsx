"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AlertsOptIn from "@/components/AlertsOptIn";
import Disclosure from "@/components/Disclosure";
import HazardIcon from "@/components/HazardIcon";
import { Check, ChevronDown, Hospital, Info, Phone, Warning } from "@/components/Icon";
import { makeT, speechLang, timeAgo, useT, type Key, type T } from "@/lib/i18n";
import { recordHistory } from "@/lib/history";
import { CACHE_KEY, loadProfile } from "@/lib/options";
import { explainTerms } from "@/lib/glossary";
import { cacheExplanation, getCachedExplanation } from "@/lib/ai-cache";
import type { LiveAlert, Severity } from "@/lib/types";

type Source = { agency: string; severity: Severity; headline: string };

type Data = {
  feeds: { sachet: { ok: boolean; degraded: boolean }; imd: { ok: boolean; degraded: boolean } };
  canVouch: boolean;
  current: {
    alert: LiveAlert;
    sources: Source[];
    conflict: boolean;
    otherHazardSources: (Source & { hazard_type: string })[];
  } | null;
  action: string;
  guide: { before: string[]; after: string[] } | null;
  occupationTip: string | null;
  vulnerabilityTips: string[];
  node: { node_id: string; last_seen: string } | null;
  fetchedAt: string;
};

const TONE: Record<Severity, string> = {
  Extreme: "var(--extreme)",
  Severe: "var(--severe)",
  Moderate: "var(--moderate)",
  Minor: "var(--minor)",
};

const LOUD: Severity[] = ["Extreme", "Severe"];
const MUTE_KEY = "ss:muteAutoRead";
const hazardKey = (h: string) => `h_${h}` as Key;

function speak(text: string, lang: string) {
  if (!("speechSynthesis" in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = speechLang(lang);
  speechSynthesis.speak(u);
}

function spokenSummary(d: Data, t: T) {
  const c = d.current;
  const head = c ? `${t(`s_${c.alert.severity}`)} ${t(hazardKey(c.alert.hazard_type))}` : t("allClear");
  return [head, c?.alert.headline, t("whatToDo"), d.action, d.occupationTip, ...d.vulnerabilityTips]
    .filter(Boolean)
    .join(". ");
}

async function notify(d: Data, t: T) {
  if (!("Notification" in window) || Notification.permission !== "granted" || !d.current) return;
  const title = `${t(`s_${d.current.alert.severity}`)} ${t(hazardKey(d.current.alert.hazard_type))}`;
  const reg = await navigator.serviceWorker?.ready;
  if (reg) reg.showNotification(title, { body: d.action, tag: d.current.alert.id, data: { url: "/" } });
  else new Notification(title, { body: d.action });
}

// Nominatim labels run long ("Ahmedabad, Gujarat, 380001, India"). The first
// two parts are the part a person recognises; the rest is postal noise.
function shortPlace(label: string) {
  const parts = label.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 2) return label;
  return parts.filter((p) => !/^\d{4,}$/.test(p)).slice(0, 2).join(", ");
}

function agencyList(sources: Source[]) {
  const names = [...new Set(sources.map((s) => s.agency))];
  return names.length <= 2 ? names.join(" · ") : `${names[0]} +${names.length - 1}`;
}

function urgencyLabel(a: LiveAlert, t: T) {
  if (a.urgency === "Immediate" || a.certainty === "Observed") return t("u_now");
  if (a.urgency === "Expected") return t("u_expected");
  if (a.urgency === "Future") return t("u_later");
  return "";
}

function Loading() {
  return (
    <main>
      <div className="skeleton line" style={{ width: "46%", height: 20 }} />
      <div className="skeleton block" style={{ height: 176 }} />
      <div className="skeleton block" style={{ height: 116 }} />
    </main>
  );
}

function Topbar({ place, t }: { place: string; t: T }) {
  return (
    <div className="topbar">
      <Link href="/setup" className="place" style={{ textDecoration: "none" }}>
        <span>{place ? shortPlace(place) : t("loading")}</span>
        <ChevronDown size={16} />
      </Link>
    </div>
  );
}

// Feed provenance belongs at the bottom in one quiet line — it is
// reassurance, not instruction, and only earns attention when it's bad news.
function FeedFooter({ data, offline, t }: { data: Data; offline: boolean; t: T }) {
  const names = [data.feeds?.sachet?.ok ? "SACHET" : null, data.feeds?.imd?.ok ? "IMD" : null].filter(Boolean);
  return (
    <p className="muted small" style={{ marginTop: 24, textAlign: "center" }}>
      {offline
        ? t("noConnection")
        : names.length
          ? t("watching", { sources: names.join(" + "), ago: timeAgo(data.fetchedAt, t) })
          : t("noFeeds")}
      {data.node && (
        <>
          <br />
          {t("nodeSynced", { id: data.node.node_id, ago: timeAgo(data.node.last_seen, t) })}
        </>
      )}
    </p>
  );
}

export default function AlertScreen() {
  const router = useRouter();
  const { lang, t } = useT();
  const [data, setData] = useState<Data | null>(null);
  const [place, setPlace] = useState("");
  const [offline, setOffline] = useState(false);
  const [serverError, setServerError] = useState(false);
  const [nothingYet, setNothingYet] = useState(false);
  const [muted, setMuted] = useState(false);
  const [ai, setAi] = useState<{ text: string | null; state: "" | "loading" | "unavailable" }>({ text: null, state: "" });
  const [coords, setCoords] = useState<{ lat: number; lng: number; language: string } | null>(null);

  useEffect(() => setMuted(localStorage.getItem(MUTE_KEY) === "1"), []);

  const currentId = data?.current?.alert.id;
  useEffect(() => setAi({ text: null, state: "" }), [currentId]);

  useEffect(() => {
    const p = loadProfile();
    // A returning visitor — the case that matters in an emergency — lands
    // directly on their alert, with no redirect hop and no blank frame.
    if (!p || !Number.isFinite(p.lat)) {
      router.replace("/setup");
      return;
    }
    setPlace(p.label);
    setCoords({ lat: p.lat, lng: p.lng, language: p.language });

    const qs = new URLSearchParams({
      lat: String(p.lat), lng: String(p.lng), district: p.district, state: p.state, label: p.label,
      occupation: p.occupation || "general_resident", dwelling: p.dwelling_type || "ground_floor",
      vulns: p.vulnerabilities.join(","), lang: p.language,
    });
    const tr = makeT(p.language);

    const load = () =>
      fetch(`/api/dashboard?${qs}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((d: Data) => {
          const prev: Data | null = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
          const changed = !!(prev && d.current && d.current.alert.id !== prev.current?.alert.id);
          const firstEver = !prev;
          if (changed) notify(d, tr);
          if (d.current && LOUD.includes(d.current.alert.severity) && localStorage.getItem(MUTE_KEY) !== "1" && (changed || firstEver)) {
            speak(spokenSummary(d, tr), p.language);
          }
          recordHistory({
            label: p.label,
            hazard_type: d.current?.alert.hazard_type ?? null,
            severity: d.current?.alert.severity ?? null,
            headline: d.current?.alert.headline ?? null,
            source_agency: d.current?.alert.source_agency ?? null,
            action: d.action,
          });
          setData(d);
          setOffline(false);
          setServerError(false);
          setNothingYet(false);
          localStorage.setItem(CACHE_KEY, JSON.stringify(d));
        })
        .catch(() => {
          const cached = localStorage.getItem(CACHE_KEY);
          if (cached) {
            setData(JSON.parse(cached));
            setNothingYet(false);
          } else setNothingYet(true);
          if (navigator.onLine) setServerError(true);
          else setOffline(true);
        });

    load();
    const id = setInterval(load, 3 * 60_000);
    return () => clearInterval(id);
  }, [router]);

  const c = data?.current ?? null;

  const explain = useCallback(async () => {
    if (!c || ai.text || ai.state === "loading") return;
    const cached = getCachedExplanation(c.alert.id);
    if (cached) return setAi({ text: cached, state: "" });
    setAi({ text: null, state: "loading" });
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headline: c.alert.headline, hazard: c.alert.hazard_type, severity: c.alert.severity,
          agencies: c.sources.map((s) => s.agency), language: lang,
        }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.text) {
        cacheExplanation(c.alert.id, d.text);
        setAi({ text: d.text, state: "" });
      } else setAi({ text: null, state: "unavailable" });
    } catch {
      setAi({ text: null, state: "unavailable" });
    }
  }, [c, ai.text, ai.state, lang]);

  if (!data && nothingYet) {
    return (
      <main>
        <Topbar place={place} t={t} />
        <p className="banner alarm">
          <Warning />
          {offline ? t("noDataOfflineBanner") : t("noDataServerBanner")}
        </p>
      </main>
    );
  }
  if (!data) return <Loading />;

  const tone = c ? TONE[c.alert.severity] : "var(--clear)";
  const loud = c ? LOUD.includes(c.alert.severity) : false;
  const glossary = c ? explainTerms(`${c.alert.headline} ${c.sources.map((s) => s.agency).join(" ")}`) : [];
  // The issuing agency's own wording always outranks anything we'd generate.
  const official = c?.alert.instruction?.trim() || null;

  return (
    <main style={{ ["--tone" as string]: tone }}>
      <Topbar place={place} t={t} />

      {offline && <p className="banner"><Info />{t("offlineBanner", { ago: timeAgo(data.fetchedAt, t) })}</p>}
      {serverError && <p className="banner"><Info />{t("serverErrorBanner")}</p>}
      {/* "We couldn't check" must never be allowed to look like "you're safe". */}
      {!data.canVouch && !offline && !serverError && (
        <p className="banner alarm"><Warning />{t("cannotVouch")}</p>
      )}

      {c ? (
        <section className={`hero${loud ? " is-loud" : ""}`}>
          <div className="sev-line">
            <span className="sev-dot" />
            <span className="sev-word">{t(`s_${c.alert.severity}`)}</span>
            <span className="sev-when">{urgencyLabel(c.alert, t)}</span>
          </div>
          <div className="hazard-row">
            <HazardIcon hazard={c.alert.hazard_type} size={34} />
            <p className="display">{t(hazardKey(c.alert.hazard_type))}</p>
          </div>
          <p className="headline">{c.alert.headline}</p>
          <div className="chips">
            <span className="chip">{agencyList(c.sources)}</span>
            <span className="chip">{t("issued", { ago: timeAgo(c.alert.timestamp, t) })}</span>
            {c.conflict && <span className="chip warn">{t("conflictShort")}</span>}
            {c.alert.degraded && <span className="chip warn">{t("degradedShort")}</span>}
          </div>
        </section>
      ) : (
        <section className="clear-state">
          <div className="clear-mark"><Check /></div>
          <h1>{t("allClear")}</h1>
          <p className="muted">{t("allClearSub")}</p>
          <p className="muted small" style={{ marginTop: 14 }}>{t("checkedAgo", { ago: timeAgo(data.fetchedAt, t) })}</p>
        </section>
      )}

      <section className="action">
        <p className="eyebrow">{t("whatToDo")}</p>
        <p>{official ?? data.action}</p>
        {official && <p className="source-note">{t("officialAdvice", { agency: c!.alert.source_agency })}</p>}
      </section>

      {(data.occupationTip || data.vulnerabilityTips.length > 0) && (
        <section className="note-card">
          <p className="eyebrow">{t("alsoForYou")}</p>
          {data.occupationTip && <p>{data.occupationTip}</p>}
          {data.vulnerabilityTips.map((x, i) => <p key={i}>{x}</p>)}
        </section>
      )}

      <div className="btn-row">
        <Link href="/help" className="btn"><Hospital />{t("nearestHospital")}</Link>
        <a href="tel:112" className="btn ghost"><Phone />112</a>
      </div>

      {coords && <AlertsOptIn lat={coords.lat} lng={coords.lng} language={coords.language} t={t} />}

      {c && (
        <>
          <Disclosure title={t("explainSimply")}>
            {ai.state === "" && !ai.text && (
              <button type="button" className="btn ghost block" onClick={explain}>{t("explainAction")}</button>
            )}
            {ai.state === "loading" && <div className="skeleton line" style={{ width: "88%" }} />}
            {ai.text && <p style={{ margin: "0 0 12px", fontSize: 16, lineHeight: 1.5 }}>{ai.text}</p>}
            {ai.state === "unavailable" && <p className="muted small" style={{ margin: "0 0 12px" }}>{t("explainUnavailable")}</p>}
            {glossary.length > 0 && (
              <dl className="defs">
                {glossary.map(([term, def], i) => (
                  <div key={i}><dt>{term}</dt><dd>{def}</dd></div>
                ))}
              </dl>
            )}
          </Disclosure>

          {data.guide && (
            <Disclosure title={t("fullPrecautions")}>
              <h3>{t("guideBefore")}</h3>
              <ul className="steps">{data.guide.before.map((x, i) => <li key={i}>{x}</li>)}</ul>
              <h3>{t("guideAfter")}</h3>
              <ul className="steps">{data.guide.after.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </Disclosure>
          )}

          <Disclosure title={t("whoReported")}>
            <ul className="steps">
              {c.sources.map((s, i) => (
                <li key={i}>{t("says", { agency: s.agency, severity: t(`s_${s.severity}`) })}</li>
              ))}
            </ul>
            {/* The forecast wording and the warned-area list: useful detail,
                but it belongs behind a tap, not above the instruction. */}
            {c.alert.description && c.alert.description !== c.alert.headline && (
              <>
                <h3>{t("forecastDetail")}</h3>
                <p className="muted small" style={{ margin: 0 }}>{c.alert.description}</p>
              </>
            )}
            {c.alert.area_text && (
              <>
                <h3>{t("warnedArea")}</h3>
                <p className="muted small" style={{ margin: 0 }}>{c.alert.area_text}</p>
              </>
            )}
            {c.conflict && <p className="muted small" style={{ marginTop: 12 }}>{t("conflict")}</p>}
            {c.otherHazardSources.length > 0 && (
              <>
                <h3>{t("hazardConflict")}</h3>
                <ul className="steps">
                  {c.otherHazardSources.map((s, i) => (
                    <li key={i}>{t("saysHazard", { agency: s.agency, hazard: t(hazardKey(s.hazard_type)) })}</li>
                  ))}
                </ul>
              </>
            )}
          </Disclosure>
        </>
      )}

      <div className="row" style={{ marginTop: 18, justifyContent: "space-between" }}>
        <button type="button" className="link-btn" onClick={() => speak(spokenSummary(data, t), lang)}>
          {t("readAloud")}
        </button>
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            const n = !muted;
            setMuted(n);
            localStorage.setItem(MUTE_KEY, n ? "1" : "0");
          }}
        >
          {muted ? t("unmuteAutoRead") : t("muteAutoRead")}
        </button>
      </div>

      <FeedFooter data={data} offline={offline} t={t} />
    </main>
  );
}
