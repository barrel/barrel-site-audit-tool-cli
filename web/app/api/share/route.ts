import { NextRequest, NextResponse } from "next/server";
import { getReport } from "@/lib/data";
import { createShareToken } from "@/lib/share";

// Not in middleware's PUBLIC_PATHS — only an already-logged-in user can mint a share link.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const id = typeof body?.id === "string" ? body.id : "";
  if (!slug || !id) {
    return NextResponse.json({ error: "Missing slug or id" }, { status: 400 });
  }

  const report = await getReport(slug, id);
  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const token = await createShareToken(slug, id);
  const url = new URL(`/share/${token}`, req.url).toString();
  return NextResponse.json({ url });
}
