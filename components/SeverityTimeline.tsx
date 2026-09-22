"use client";
import type { HistoryEntry } from "@/lib/history";
import type { T } from "@/lib/i18n";

const COLOR: Record<string, string> = {
  Extreme: "var(--extreme)", Severe: "var(--severe)", Moderate: "var(--moderate)", Minor: "var(--minor)",
};
const CALM = "var(--line)";
const WIDTH = 320;
const HEIGHT = 34;
const SPAN_MS = 5 * 24 * 60 * 60 * 1000;

// A 5-day timeline, proportional by time: each segment's width is how long
// that severity level (or calm) was actually in effect, computed from
// consecutive history entries — not a bar chart of counts, an actual clock.
export default function SeverityTimeline({ history, t }: { history: HistoryEntry[]; t: T }) {
  if (history.length === 0) return null;
  const now = Date.now();
  const start = now - SPAN_MS;
  const chrono = [...history].reverse(); // oldest first

  const segments: { from: number; to: number; color: string }[] = [];
  for (let i = 0; i < chrono.length; i++) {
    const entry = chrono[i];
    const from = Math.max(start, new Date(entry.timestamp).getTime());
    const to = i + 1 < chrono.length ? new Date(chrono[i + 1].timestamp).getTime() : now;
    if (to <= from) continue;
    segments.push({ from, to, color: entry.severity ? COLOR[entry.severity] : CALM });
  }
  // Fill any gap before the first recorded entry as "unknown/calm" too.
  if (segments.length && segments[0].from > start) segments.unshift({ from: start, to: segments[0].from, color: CALM });

  const seen = new Set(segments.map((s) => s.color));
  const present = [
    ...(["Extreme", "Severe", "Moderate", "Minor"] as const)
      .filter((s) => seen.has(COLOR[s]))
      .map((s) => ({ label: t(`s_${s}`), color: COLOR[s] })),
    ...(seen.has(CALM) ? [{ label: t("allClear"), color: CALM }] : []),
  ];

  return (
    <div style={{ marginTop: 8 }}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT} preserveAspectRatio="none" role="img" aria-label={t("historyTitle")}>
        <rect x={0} y={8} width={WIDTH} height={16} rx={8} fill="var(--surface-2)" />
        {segments.map((s, i) => {
          const x = ((s.from - start) / SPAN_MS) * WIDTH;
          const w = Math.max(1, ((s.to - s.from) / SPAN_MS) * WIDTH);
          return <rect key={i} x={x} y={8} width={w} height={16} fill={s.color} />;
        })}
      </svg>
      <div className="row muted" style={{ fontSize: 12, justifyContent: "space-between", marginTop: 4 }}>
        <span>{t("fiveDaysAgo")}</span>
        <span>{t("now")}</span>
      </div>
      {/* Only label what the chart actually contains — a full five-key legend
          against a bar with one colour in it is noise, not explanation. */}
      <div className="row" style={{ gap: 12, marginTop: 10, flexWrap: "wrap" }}>
        {present.map(({ label, color }) => (
          <span key={label} className="row muted" style={{ fontSize: 13, gap: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: color, display: "inline-block" }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
