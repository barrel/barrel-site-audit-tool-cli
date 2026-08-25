import { NextRequest, NextResponse } from "next/server";
import {
  LABS_COOKIE_NAME,
  authorizeUrl,
  isAdminOnlyPath,
  verifySessionCookie,
} from "@/lib/labs-auth";
import { SHARE_SCOPE_COOKIE_NAME, tokenScope, verifyShareToken } from "@/lib/share";

/** Reachable with no Barrel Labs session at all.
 *
 * This list is deliberately down to one entry. /labs-error cannot be gated: it is where a failed
 * handoff lands, so putting it behind the gate sends the browser straight back through the gate
 * that just failed, forever. /instructions and /release-notes were public under the old
 * shared-password login and are not any more — everything the app itself serves now needs a Barrel
 * identity.
 *
 * The two other ungated surfaces are handled by their own branches below rather than living here:
 * the SSO callback (which is the only route that can land a session) and /share/<token> client
 * report links (whose entire purpose is to open for someone with no Barrel account). */
const PUBLIC_PATHS = ["/labs-error"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // The SSO callback MUST stay ungated: it is the only route that can land a session cookie, so
  // gating it is an infinite redirect loop.
  if (pathname.startsWith("/api/labs-auth")) {
    return NextResponse.next();
  }

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
      res.cookies.set(SHARE_SCOPE_COOKIE_NAME, tokenScope(payload), {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge,
        path: "/api/screenshot",
      });
    }
    return res;
  }

  // Screenshots are proxied blobs, normally gated by the same Labs session as the rest of the
  // app. A valid share-scope cookie (set above, scoped to exactly one report) additionally
  // authorizes only the screenshots living under that report's own path prefix.
  if (pathname.startsWith("/api/screenshot/")) {
    if (await verifySessionCookie(req.cookies.get(LABS_COOKIE_NAME)?.value)) {
      return NextResponse.next();
    }

    const scope = req.cookies.get(SHARE_SCOPE_COOKIE_NAME)?.value ?? "";
    const [storeSlug, reportId] = pathname.slice("/api/screenshot/".length).split("/");
    // Membership, not equality: a client report authorises the baseline's screenshots as well as
    // the latest run's, and the scope is still an explicit list rather than a prefix.
    if (scope && scope.split(",").includes(`${storeSlug}/${reportId}`)) return NextResponse.next();

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const session = await verifySessionCookie(req.cookies.get(LABS_COOKIE_NAME)?.value);

  // No session, or one that has aged past its 8-hour window: hand the browser to Labs. For anyone
  // whose Labs sign-in is still live this is a redirect they never see, which is why the window
  // can be short enough for an access revocation to bite the same day.
  if (!session) {
    const { pathname: p, search } = req.nextUrl;
    return NextResponse.redirect(authorizeUrl(`${p}${search}`));
  }

  // Signed in, but Privacy Compliance is admins only. Enforced here as well as in the pages so a
  // route added under /consent later is covered by default rather than by remembering to.
  if (session.role !== "admin" && isAdminOnlyPath(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Admins only." }, { status: 403 });
    }
    // Rewrite, not redirect: the person keeps the URL they were sent, so the explanation lands
    // where they are instead of bouncing them somewhere that looks like the link was broken.
    return NextResponse.rewrite(new URL("/admins-only", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
