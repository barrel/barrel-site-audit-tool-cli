import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getUnlockedShare } from "@/lib/secure-report-access";

export const dynamic = "force-dynamic";

/** Evidence screenshots for a password-gated report. Serves only consent/<site>/<this link's scan>/…
 * — the unlock cookie authorises one scan, not the screenshot store. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; path: string[] }> }) {
  const { id, path } = await params;
  const record = await getUnlockedShare(id);
  if (!record) return new NextResponse(null, { status: 404 });

  const [ns, siteSlug, scanId, file, ...rest] = path;
  const safe = (s: string | undefined) => !!s && /^[A-Za-z0-9._-]+$/.test(s) && s !== "." && s !== "..";
  if (ns !== "consent" || rest.length > 0 || ![siteSlug, scanId, file].every(safe) || scanId !== record.scanId) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const result = await get(`screenshots/consent/${siteSlug}/${scanId}/${file}`, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) return new NextResponse(null, { status: 404 });
    return new NextResponse(result.stream, {
      headers: { "Content-Type": result.blob.contentType || "image/jpeg", "Cache-Control": "private, no-store" },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
