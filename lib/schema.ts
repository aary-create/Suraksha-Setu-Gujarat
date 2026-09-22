import type { NeonQueryFunction } from "@neondatabase/serverless";

type Db = NeonQueryFunction<false, false>;

const STATEMENTS = [
  `create table if not exists users (
    id serial primary key, label text not null, lat double precision not null, lng double precision not null,
    district text not null default '', state text not null default '',
    dwelling_type text not null, occupation text not null, vulnerabilities text[] not null default '{}',
    language text not null default 'en', created_at timestamptz not null default now())`,
  `create table if not exists esp32_nodes (
    node_id text primary key, lat double precision not null, lng double precision not null,
    last_cached_ts bigint, last_seen timestamptz not null default now())`,
  // Where to reach a phone that isn't currently looking at the app. Stores the
  // browser's own push endpoint plus the point to match alerts against —
  // deliberately no profile, no vulnerabilities, nothing identifying.
  `create table if not exists push_subscriptions (
    endpoint text primary key, p256dh text not null, auth text not null,
    lat double precision not null, lng double precision not null,
    language text not null default 'en',
    last_alert_id text, last_pushed_at timestamptz,
    created_at timestamptz not null default now())`,
];

// Creates tables on first use. No sample data to seed anymore — alerts are
// always live (SACHET/IMD) or real user reports, never fabricated.
let ready: Promise<void> | null = null;
export async function setupDatabase(db: Db) {
  ready ??= (async () => {
    for (const s of STATEMENTS) await db.query(s);
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}
