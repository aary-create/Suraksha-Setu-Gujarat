import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { pushConfigured } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!pushConfigured) return NextResponse.json({ error: "push not configured" }, { status: 501 });
  if (!sql) return NextResponse.json({ error: "push needs a database" }, { status: 501 });

  const body = await req.json().catch(() => null);
  const endpoint = body?.subscription?.endpoint;
  const p256dh = body?.subscription?.keys?.p256dh;
  const auth = body?.subscription?.keys?.auth;
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!endpoint || !p256dh || !auth || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "endpoint, keys and a location are required" }, { status: 400 });
  }

  await sql`insert into push_subscriptions (endpoint, p256dh, auth, lat, lng, language)
    values (${endpoint}, ${p256dh}, ${auth}, ${lat}, ${lng}, ${String(body?.language ?? "en")})
    on conflict (endpoint) do update set
      p256dh = excluded.p256dh, auth = excluded.auth,
      lat = excluded.lat, lng = excluded.lng, language = excluded.language`;

  return NextResponse.json({ subscribed: true });
}

export async function DELETE(req: Request) {
  if (!sql) return NextResponse.json({ unsubscribed: true });
  const endpoint = (await req.json().catch(() => null))?.endpoint;
  if (endpoint) await sql`delete from push_subscriptions where endpoint = ${endpoint}`;
  return NextResponse.json({ unsubscribed: true });
}
