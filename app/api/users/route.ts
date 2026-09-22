import { NextResponse } from "next/server";
import { saveUser } from "@/lib/data";
import type { Profile } from "@/lib/types";

export async function POST(req: Request) {
  const p = (await req.json()) as Partial<Profile>;
  // Location is the only thing the app genuinely needs. Home type and
  // occupation merely sharpen the advice and are explicitly skippable, so
  // demanding them here would reject a perfectly usable profile.
  if (!p.label || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
    return NextResponse.json({ error: "a resolved location is required" }, { status: 400 });
  }
  const profile: Profile = {
    label: p.label, lat: p.lat!, lng: p.lng!, district: p.district ?? "", state: p.state ?? "",
    dwelling_type: p.dwelling_type ?? "", occupation: p.occupation ?? "",
    vulnerabilities: p.vulnerabilities ?? [], language: p.language ?? "en",
  };
  return NextResponse.json(await saveUser(profile));
}
