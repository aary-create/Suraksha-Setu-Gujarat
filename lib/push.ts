import webpush from "web-push";
import { sql } from "./db";
import { haversineKm } from "./geo";
import type { LiveAlert } from "./types";

// Polling only works while the app is open. An Extreme alert has to reach a
// phone that's in someone's pocket, which means the server has to initiate.
// Keys are generated once with `npx web-push generate-vapid-keys` and set as
// env vars; without them push is simply disabled and the rest of the app is
// unaffected.
const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const CONTACT = process.env.VAPID_CONTACT ?? "mailto:alerts@example.org";

export const pushConfigured = Boolean(PUBLIC_KEY && PRIVATE_KEY);
if (pushConfigured) webpush.setVapidDetails(CONTACT, PUBLIC_KEY, PRIVATE_KEY);

export type PushTarget = {
  endpoint: string;
  p256dh: string;
  auth: string;
  lat: number;
  lng: number;
  language: string;
  last_alert_id: string | null;
};

// Only the genuinely urgent tiers are worth waking a phone for. Pushing
// Moderate advisories trains people to swipe the notification away, which
// costs lives the one time it says Extreme.
export function worthPushing(a: LiveAlert): boolean {
  return a.severity === "Extreme" || a.severity === "Severe";
}

export async function subscribersNear(lat: number, lng: number, km: number): Promise<PushTarget[]> {
  if (!sql) return [];
  const rows = (await sql`select endpoint, p256dh, auth, lat, lng, language, last_alert_id from push_subscriptions`) as any[];
  return rows.filter((r) => haversineKm({ lat, lng }, { lat: Number(r.lat), lng: Number(r.lng) }) <= km);
}

export async function sendPush(target: PushTarget, payload: Record<string, unknown>): Promise<"sent" | "expired" | "failed"> {
  if (!pushConfigured) return "failed";
  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      { urgency: "high", TTL: 3600 }
    );
    return "sent";
  } catch (err: any) {
    // 404/410 mean the browser threw the subscription away — prune it rather
    // than retrying it forever on every future alert.
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      if (sql) await sql`delete from push_subscriptions where endpoint = ${target.endpoint}`;
      return "expired";
    }
    console.error("[PUSH] send failed:", err?.statusCode, err?.body ?? err);
    return "failed";
  }
}

export async function markPushed(endpoint: string, alertId: string) {
  if (!sql) return;
  await sql`update push_subscriptions set last_alert_id = ${alertId}, last_pushed_at = now() where endpoint = ${endpoint}`;
}
