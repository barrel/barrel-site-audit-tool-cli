import { get } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Proxies screenshot blobs so the private Blob store's read-write token never reaches the
// browser. Scoped to the screenshots/ prefix — this route can't read any other blob path.
// Already gated by the app-wide login middleware (not in PUBLIC_PATHS).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const segments = path.filter((segment) => segment && segment !== "." && segment !== "..");
  if (segments.length === 0) return new NextResponse(null, { status: 404 });

  const pathname = `screenshots/${segments.join("/")}`;

  try {
    const result = await get(pathname, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return new NextResponse(null, { status: 404 });
    }
    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": result.blob.contentType || "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
