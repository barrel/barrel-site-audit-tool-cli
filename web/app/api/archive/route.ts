import { NextRequest, NextResponse } from "next/server";
import { getManifest, writeManifest } from "@/lib/data";

// Not in middleware's PUBLIC_PATHS — only an already-logged-in teammate can archive a report.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const id = typeof body?.id === "string" ? body.id : "";
  if (!slug || !id) {
    return NextResponse.json({ error: "Missing slug or id" }, { status: 400 });
  }

  const manifest = await getManifest();
  const target = manifest.reports.find((r) => r.storeSlug === slug && r.id === id);
  if (!target) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  // Toggle — unlike baseline, archiving has no "at most one" constraint, so every other
  // entry is left untouched.
  const archived = !target.archived;
  manifest.reports = manifest.reports.map((r) => (r.id === id ? { ...r, archived } : r));

  await writeManifest(manifest);
  return NextResponse.json({ ok: true, archived });
}
