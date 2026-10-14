import { NextRequest, NextResponse } from "next/server";
import { getConsentScan } from "@/lib/data";
import { createShare, listSharesForScan, parseEmails, revokeShare } from "@/lib/consent-share";
import { getLabsSession } from "@/lib/labs-session";

export const dynamic = "force-dynamic";

// Admin-only twice over: middleware rejects non-admins for this prefix, and each handler re-checks.
async function requireAdmin() {
  const session = await getLabsSession();
  return session?.role === "admin" ? session : null;
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const scanId = req.nextUrl.searchParams.get("scan");
  if (!scanId) return NextResponse.json({ error: "Missing scan." }, { status: 400 });
  return NextResponse.json({ shares: await listSharesForScan(scanId) });
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const scanId = typeof body?.scanId === "string" ? body.scanId : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const days = Number(body?.expiresInDays);
  const { emails, invalid } = parseEmails(typeof body?.emails === "string" ? body.emails : "");

  if (!scanId || !(await getConsentScan(scanId))) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }
  if (invalid.length > 0) {
    return NextResponse.json({ error: `Not a valid email: ${invalid.join(", ")}` }, { status: 400 });
  }
  if (![7, 30, 90].includes(days)) {
    return NextResponse.json({ error: "Choose 7, 30 or 90 days." }, { status: 400 });
  }

  try {
    const record = await createShare({
      scanId,
      emails,
      password,
      expiresInDays: days,
      createdBy: (session as { email?: string }).email,
    });
    return NextResponse.json({ url: new URL(`/secure-report/${record.id}`, req.url).toString(), id: record.id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not create the link." }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id || !(await revokeShare(id))) return NextResponse.json({ error: "Link not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
