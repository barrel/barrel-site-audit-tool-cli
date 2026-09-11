import { NextRequest, NextResponse } from "next/server";
import {
  clearDeviceCode,
  getGithubSession,
  readDeviceCode,
  stashDeviceCode,
  startGithubSession,
} from "@/lib/github-session";
import { githubUser } from "@/lib/github";

export const dynamic = "force-dynamic";

/**
 * GitHub's OAuth **device flow**, run from the dashboard.
 *
 * Why the device flow and not the ordinary redirect flow, which is one click instead of a typed
 * code: the redirect flow needs a client *secret* deployed here. The device flow needs only the
 * Client ID — which is not a secret, is already what the CLI uses, and is already the one GitHub
 * value this tool asks anyone to configure. So the dashboard connects with no new credential on
 * the deployment and no second OAuth app to keep in step with the CLI's.
 *
 * Two steps, both POSTs, because a browser cannot call GitHub's token endpoint itself (no CORS,
 * and the exchange should not happen in a page anyway):
 *   { action: "start" } → a user_code to type at github.com and the URL to type it into
 *   { action: "poll" }  → "pending" until it's approved, then the token is sealed into a cookie
 *
 * The device_code — the half that is actually exchanged for a token — never reaches the page. It
 * is held in its own httpOnly cookie between the two calls (see lib/github-session.ts).
 */

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";

// Same scope the CLI requests. GitHub's OAuth Apps have no read-only scope covering private
// repository contents — `repo` is all-or-nothing — and client theme repos are private, so this is
// the only scope that can read them at all. The read-only guarantee therefore lives in the code
// that uses the token (lib/github.ts, which only ever reads) rather than in the scope itself.
const SCOPE = "repo";

function clientId(): string {
  const id = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!id) {
    throw new Error(
      "GITHUB_OAUTH_CLIENT_ID is not set on this deployment, so the dashboard can't connect to GitHub. " +
        "It's the Client ID of the shared Barrel OAuth App (the same value the CLI uses) — not a secret. " +
        "Add it in the Vercel project's environment variables and redeploy.",
    );
  }
  return id;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { action?: string } | null;

  try {
    if (body?.action === "start") return await start();
    if (body?.action === "poll") return await poll();
    return NextResponse.json({ error: 'Expected { action: "start" } or { action: "poll" }.' }, { status: 400 });
  } catch (err: unknown) {
    return NextResponse.json({ error: String((err as Error)?.message ?? err) }, { status: 400 });
  }
}

async function start(): Promise<NextResponse> {
  const existing = await getGithubSession();
  if (existing) return NextResponse.json({ connected: true, login: existing.login });

  const res = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId(), scope: SCOPE }),
  });
  const data = (await res.json().catch(() => null)) as
    | { device_code?: string; user_code?: string; verification_uri?: string; interval?: number; expires_in?: number; error_description?: string }
    | null;

  if (!res.ok || !data?.device_code || !data.user_code) {
    throw new Error(
      data?.error_description ??
        `GitHub refused to start a device login (${res.status}). Check that Device Flow is enabled on the OAuth App.`,
    );
  }

  await stashDeviceCode(data.device_code, data.interval ?? 5);

  // Deliberately does NOT include device_code: the page has no use for it and every reason not to
  // hold it. The user_code is the half meant to be read and typed.
  return NextResponse.json({
    connected: false,
    userCode: data.user_code,
    verificationUri: data.verification_uri ?? "https://github.com/login/device",
    interval: data.interval ?? 5,
    expiresIn: data.expires_in ?? 900,
  });
}

async function poll(): Promise<NextResponse> {
  const stashed = await readDeviceCode();
  if (!stashed) {
    return NextResponse.json(
      { status: "expired", error: "That sign-in attempt has expired. Start it again." },
      { status: 400 },
    );
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: clientId(),
      device_code: stashed.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const data = (await res.json().catch(() => null)) as
    | { access_token?: string; error?: string; error_description?: string; interval?: number }
    | null;

  // The two non-errors of the device flow: nobody has approved it yet, and "you're polling too
  // fast". Both mean keep waiting, so neither is reported as a failure.
  if (data?.error === "authorization_pending") return NextResponse.json({ status: "pending" });
  if (data?.error === "slow_down") return NextResponse.json({ status: "pending", interval: data.interval ?? 10 });

  if (!data?.access_token) {
    await clearDeviceCode();
    const reason =
      data?.error === "expired_token"
        ? "the code expired before it was approved"
        : data?.error === "access_denied"
          ? "the sign-in was declined on GitHub"
          : (data?.error_description ?? `GitHub returned ${res.status}`);
    return NextResponse.json({ status: "failed", error: `Could not finish signing in — ${reason}.` }, { status: 400 });
  }

  // Sealed into the session cookie first, then read back through the same path everything else
  // uses — so a token that somehow can't be read back is reported now rather than as a mystery
  // "not connected" on the next request.
  await startGithubSession(data.access_token, "");
  const user = await githubUser().catch(() => null);
  if (!user) {
    return NextResponse.json(
      { status: "failed", error: "GitHub issued a token but then refused to identify it. Try connecting again." },
      { status: 502 },
    );
  }
  await startGithubSession(data.access_token, user.login);
  await clearDeviceCode();

  return NextResponse.json({ status: "connected", login: user.login, name: user.name });
}
