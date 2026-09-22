"use client";
import { useEffect, useRef, useState } from "react";
import { Info, Phone } from "@/components/Icon";
import { useT } from "@/lib/i18n";
import { darkenTiles, loadLeaflet } from "@/lib/leaflet";
import seed from "@/data/seed.json";
const { helplines } = seed;
import { loadProfile } from "@/lib/options";
import type { HelpPlace } from "@/lib/types";

export default function Help() {
  const mapEl = useRef<HTMLDivElement>(null);
  const { t } = useT();
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [hospitals, setHospitals] = useState<HelpPlace[] | null>(null);
  const [error, setError] = useState<"" | "noGeo" | "locOff">("");

  useEffect(() => {
    const p = loadProfile();
    if (p && Number.isFinite(p.lat)) return setMe({ lat: p.lat, lng: p.lng });
    if (!navigator.geolocation) return setError("noGeo");
    navigator.geolocation.getCurrentPosition(
      (pos) => setMe({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setError("locOff"),
      { enableHighAccuracy: true }
    );
  }, []);

  useEffect(() => {
    if (!me) return;
    fetch(`/api/hospitals?lat=${me.lat}&lng=${me.lng}`)
      .then((r) => r.json())
      .then((d) => setHospitals(d.hospitals ?? []))
      .catch(() => setHospitals([]));

    if (!mapEl.current) return;
    loadLeaflet().then((L) => {
      const map = L.map(mapEl.current, { zoomControl: true, attributionControl: true }).setView([me.lat, me.lng], 13);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);
      darkenTiles(map);
      L.circleMarker([me.lat, me.lng], { radius: 8, color: "#fff", weight: 2, fillColor: "#7cc4ff", fillOpacity: 1 })
        .addTo(map).bindPopup(t("youAreHere"));
      (mapEl.current as any)._leafletMap = map;
    }).catch(() => {});
  }, [me?.lat, me?.lng]);

  // Plot hospital markers once both the map and the results are ready.
  useEffect(() => {
    const map = (mapEl.current as any)?._leafletMap;
    if (!map || !hospitals || !window.L) return;
    const L = window.L;
    const bounds = L.latLngBounds([[me!.lat, me!.lng]]);
    hospitals.forEach((h) => {
      L.marker([h.lat, h.lng]).addTo(map).bindPopup(h.name);
      bounds.extend([h.lat, h.lng]);
    });
    if (hospitals.length) map.fitBounds(bounds, { padding: [40, 40] });
  }, [hospitals]);

  return (
    <main>
      <h1>{t("helpTitle")}</h1>

      {/* Calling comes first. It is the fastest thing a person in trouble can
          do, and it works with no map, no data and no location permission. */}
      <a href="tel:112" className="btn block" style={{ marginTop: 16 }}>
        <Phone />
        {t("call", { n: 112 })}
      </a>
      <div className="helpline-row">
        {helplines.map((hl, i) => (
          <a key={i} className="helpline" href={`tel:${hl.contact}`}>
            <b>{hl.contact}</b>
            <span>{hl.name}</span>
          </a>
        ))}
      </div>

      <h2>{t("findNearestHospital")}</h2>
      <p className="muted small" style={{ marginTop: -4 }}>{t("hospitalsNote")}</p>
      {error && <p className="banner" style={{ marginTop: 12 }}><Info />{t(error)}</p>}

      {me && <div ref={mapEl} className="map" />}

      {hospitals === null ? (
        <>
          <div className="skeleton line" style={{ width: "70%" }} />
          <div className="skeleton line" style={{ width: "55%" }} />
          <div className="skeleton line" style={{ width: "62%" }} />
        </>
      ) : hospitals.length === 0 ? (
        <p className="muted">{t("noHospitals")}</p>
      ) : (
        <div>
          {hospitals.map((h) => (
            <div className="place-row" key={h.place_id}>
              <a
                className="place-main"
                href={`https://www.openstreetmap.org/directions?to=${h.lat},${h.lng}`}
                target="_blank"
                rel="noreferrer"
              >
                <span className="place-name">{h.name}</span>
                <span className="place-dist">{t("distanceAway", { km: h.distance_km.toFixed(1) })}</span>
              </a>
              {h.phone && (
                <a className="icon-btn" href={`tel:${h.phone}`} aria-label={t("call", { n: h.phone })}>
                  <Phone size={18} />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
