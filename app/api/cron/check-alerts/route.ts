import { NextResponse } from "next/server";
import { alertsNear, currentAlert, fetchLiveAlerts } from "@/lib/data";
import { HAZARD_LABEL } from "@/lib/severity";
import { markPushed, pushConfigured, sendPush, subscribersNear, worthPushing } from "@/lib/push";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Run by Vercel Cron (see vercel.json). Walks every push subscriber, works out
// what's currently live at their exact point, and wakes the phone only when
// the alert is both serious and something that subscriber hasn't already been
// told about — so a 12-hour cyclone warning pushes once, not every few minutes.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!pushConfigured || !sql) return NextResponse.json({ skipped: "push not configured" });

  const { alerts } = await fetchLiveAlerts();
  const subs = (await sql`select endpoint, p256dh, auth, lat, lng, language, last_alert_id from push_subscriptions`) as any[];

  let sent = 0;
  let skipped = 0;
  let expired = 0;

  for (const s of subs) {
    const lat = Number(s.lat);
    const lng = Number(s.lng);
    const current = currentAlert(alertsNear(alerts, lat, lng, "", ""));
    if (!current || !worthPushing(current.alert)) { skipped++; continue; }
    if (current.alert.id === s.last_alert_id) { skipped++; continue; }

    const hazard = HAZARD_LABEL[current.alert.hazard_type] ?? "Weather alert";
    const result = await sendPush(s, {
      title: `${current.alert.severity}: ${hazard}`,
      body: current.alert.headline,
      alertId: current.alert.id,
      severity: current.alert.severity,
      url: "/",
    });
    if (result === "sent") { await markPushed(s.endpoint, current.alert.id); sent++; }
    else if (result === "expired") expired++;
  }

  return NextResponse.json({ checked: subs.length, sent, skipped, expired });
}
