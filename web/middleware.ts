import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";
import { SHARE_SCOPE_COOKIE_NAME, verifyShareToken } from "@/lib/share";

const PUBLIC_PATHS = ["/login", "/api/login", "/instructions"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Share links are the one intentionally-public report view — anyone with the link needs to
  // see it with no session. Verifying the token here (not just in the page) also lets us drop
  // a short-lived, narrowly-scoped cookie that authorizes only THIS report's screenshot images;
  // the page itself re-verifies the token independently and 404s if it's invalid/expired.
  if (pathname === "/share" || pathname.startsWith("/share/")) {
    const token = pathname.slice("/share/".length);
    const payload = await verifyShareToken(token);
    const res = NextResponse.next();
    if (payload) {
      const maxAge = Math.max(0, Math.floor((payload.expires - Date.now()) / 1000));
      res.cookies.set(SHARE_SCOPE_COOKIE_NAME, `${payload.slug}/${payload.id}`, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge,
        path: "/api/screenshot",
      });
    }
    return res;
  }

  // Screenshots are proxied blobs, normally gated by the same login session as the rest of the
  // app. A valid share-scope cookie (set above, scoped to exactly one report) additionally
  // authorizes only the screenshots living under that report's own path prefix.
  if (pathname.startsWith("/api/screenshot/")) {
    const sessionToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (await verifySessionToken(sessionToken)) return NextResponse.next();

    const scope = req.cookies.get(SHARE_SCOPE_COOKIE_NAME)?.value ?? "";
    const [storeSlug, reportId] = pathname.slice("/api/screenshot/".length).split("/");
    if (scope && scope === `${storeSlug}/${reportId}`) return NextResponse.next();

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const valid = await verifySessionToken(token);

  if (!valid) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
