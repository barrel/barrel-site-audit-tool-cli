import { NextRequest, NextResponse } from "next/server";
import { getCroReport } from "@/lib/data";
import { createShareToken } from "@/lib/share";

// Not in middleware's PUBLIC_PATHS — only an already-logged-in Barrel user can mint a share link.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const id = typeof body?.id === "string" ? body.id : "";
  if (!slug || !id) return NextResponse.json({ error: "Missing slug or id" }, { status: 400 });

  // Verified before it is signed. A token naming an audit that does not exist would produce a link
  // that looks valid, passes the signature check, and 404s in the client's browser.
  const report = await getCroReport(slug, id);
  if (!report) return NextResponse.json({ error: "CRO audit not found" }, { status: 404 });

  const token = await createShareToken(slug, id, { resource: "cro" });
  const url = new URL(`/share/${token}`, req.url).toString();
  return NextResponse.json({ url });
}
