import { NextResponse } from "next/server";

import { startSession } from "@/lib/labs-session";
import { verifyLabsToken } from "@/lib/labs-auth";

/** Where Barrel Labs hands back a verified identity. Exchanges the one-minute handoff token for
 * this app's own session cookie and discards it — the token never reaches the browser's storage. */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const token = url.searchParams.get("labs_token");
  const state = url.searchParams.get("state") ?? "/";

  // Failures go to /labs-error, never back to "/". "/" is the gate: it would re-authorize, fail
  // the same way, and loop until the browser gives up with ERR_TOO_MANY_REDIRECTS.
  if (!token) {
    return NextResponse.redirect(new URL("/labs-error?reason=missing_token", url.origin));
  }

  try {
    await startSession(await verifyLabsToken(token));
  } catch (err) {
    console.error("[labs-auth] token verification failed", err);
    return NextResponse.redirect(new URL("/labs-error?reason=invalid_token", url.origin));
  }

  // `state` came back through the browser, so it is untrusted: only ever redirect to a path on
  // this origin. Without the check, a crafted authorize link could land someone on another site
  // immediately after signing in to ours.
  const safePath = state.startsWith("/") && !state.startsWith("//") ? state : "/";
  return NextResponse.redirect(new URL(safePath, url.origin));
}
