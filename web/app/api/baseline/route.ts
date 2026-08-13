import { NextRequest, NextResponse } from "next/server";
import { getManifest, writeManifest } from "@/lib/data";

// Not in middleware's PUBLIC_PATHS — only an already-logged-in teammate can move a baseline.
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

  // Toggle: re-marking the current baseline clears it (falls back to earliest report);
  // marking a different report moves the baseline — at most one per store either way.
  const makeBaseline = !target.isBaseline;
  manifest.reports = manifest.reports.map((r) =>
    r.storeSlug === slug ? { ...r, isBaseline: r.id === id ? makeBaseline : false } : r,
  );

  await writeManifest(manifest);
  return NextResponse.json({ ok: true, isBaseline: makeBaseline });
}
