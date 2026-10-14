import { NextRequest, NextResponse } from "next/server";
import { attemptUnlock, getShare, makeUnlockCookie, secureReportCookieName } from "@/lib/consent-share";

export const dynamic = "force-dynamic";

/** The unlock form posts here. Public by necessity (the visitor has no Barrel account), so the
 * protection lives entirely in attemptUnlock: email on the list AND password, with a lockout. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  const email = String(form?.get("email") ?? "");
  const password = String(form?.get("password") ?? "");

  const back = (e?: string) =>
    NextResponse.redirect(new URL(`/secure-report/${id}${e ? `?e=${e}` : ""}`, req.url), { status: 303 });

  const result = await attemptUnlock(id, email, password);
  if (result === "locked") return back("locked");
  if (result !== "ok") return back(result === "unavailable" ? undefined : "denied");

  const record = await getShare(id);
  if (!record) return back();
  const { value, maxAge } = makeUnlockCookie(record);
  const res = back();
  res.cookies.set(secureReportCookieName(id), value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    // Site root, not the page path: the same unlock also has to reach the screenshot route under
    // /api/secure-report/<id>. The value is still bound to this one link by its signature.
    path: "/",
    maxAge,
  });
  return res;
}
