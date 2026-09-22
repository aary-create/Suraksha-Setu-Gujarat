"use client";
import { useEffect, useState } from "react";
import HazardIcon from "@/components/HazardIcon";
import SeverityBadge from "@/components/SeverityBadge";
import SeverityTimeline from "@/components/SeverityTimeline";
import PersonalStats from "@/components/PersonalStats";
import { Info } from "@/components/Icon";
import { timeAgo, useT, type Key } from "@/lib/i18n";
import { readHistory, type HistoryEntry } from "@/lib/history";
import { CACHE_KEY } from "@/lib/options";

export default function History() {
  const { t } = useT();
  const [cached, setCached] = useState<any>(undefined);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setCached(JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null"));
    setHistory(readHistory());
    setOnline(navigator.onLine);
  }, []);

  if (cached === undefined) return <main />;

  return (
    <main>
      <h1>{t("historyTitle")}</h1>
      <p className="muted" style={{ marginTop: 8 }}>{t("historyNote")}</p>

      {!online && <p className="banner" style={{ marginTop: 16 }}><Info />{t("offlineNote")}</p>}

      {history.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <SeverityTimeline history={history} t={t} />
        </div>
      )}

      {history.length === 0 ? (
        <p className="muted" style={{ marginTop: 22 }}>{t("noHistory")}</p>
      ) : (
        <ul className="list" style={{ marginTop: 18 }}>
          {history.map((h, i) => (
            <li key={i} className={h.severity ? `sev-${h.severity}` : undefined}>
              {h.hazard_type ? (
                <>
                  <div className="row">
                    <SeverityBadge severity={h.severity!} t={t} />
                    <HazardIcon hazard={h.hazard_type} size={17} />
                    <span className="title">{t(`h_${h.hazard_type}` as Key)}</span>
                  </div>
                  <div style={{ marginTop: 7 }}>{h.headline}</div>
                  <div className="muted small" style={{ marginTop: 4 }}>
                    {h.source_agency}, {timeAgo(h.timestamp, t)}
                  </div>
                </>
              ) : (
                <>
                  <div className="title">{t("allClear")}</div>
                  <div className="muted small" style={{ marginTop: 4 }}>{h.label}, {timeAgo(h.timestamp, t)}</div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {history.some((h) => h.hazard_type) && (
        <>
          <h2>{t("statsTitle")}</h2>
          <PersonalStats history={history} t={t} />
        </>
      )}

      {cached && (
        <>
          <h2>{t("lastSavedTitle")}</h2>
          <p className="muted small">{t("lastSynced", { time: new Date(cached.fetchedAt).toLocaleString() })}</p>
          <div className="note-card" style={{ marginTop: 10 }}>
            <p className="eyebrow">{t("whatToDo")}</p>
            <p>{cached.action}</p>
          </div>
        </>
      )}

      <p className="muted small" style={{ marginTop: 26, textAlign: "center" }}>{t("nodeHint")}</p>
    </main>
  );
}
