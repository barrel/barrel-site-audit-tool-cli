/**
 * Barrel Labs SSO — the parts that must run at the edge.
 *
 * Barrel Labs (https://barrel-labs.vercel.app) is the identity provider for Barrel's internal
 * tools: it owns the Google sign-in, the "is this person still staff" question, and the per-app
 * access list. This app holds no key capable of *minting* a Labs token — only the public JWKS it
 * verifies one against — so a compromise here cannot forge access to any other Barrel tool.
 *
 * Everything in this file is deliberately free of `next/headers`, because `middleware.ts` imports
 * it and the middleware runtime has no cookie store. The cookie-store side lives in
 * `lib/labs-session.ts`.
 */
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";

/** This app's own session cookie — not the Labs one, and not readable by Labs. */
export const LABS_COOKIE_NAME = "labs_session";

/**
 * How long this app trusts a handoff before silently re-checking with Labs.
 *
 * The re-auth costs the user nothing — their Labs Google session is still live, so the round trip
 * is a redirect they never see — which is why this is hours rather than days. It is also the
 * revocation window: removing someone's grant in Labs stops them here within this long, not
 * instantly.
 */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export type LabsSession = {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
  /** `admin` means a Barrel Labs admin — the gate on this app's admin-only surfaces. */
  role: "admin" | "member";
  clearance: number;
};

export const LABS_URL = (process.env.LABS_URL ?? "https://barrel-labs.vercel.app").replace(/\/$/, "");

/** Must match the slug registered in Labs → Control → Experiments; it is the token audience. */
const APP_SLUG = process.env.LABS_APP_SLUG ?? "";

function sessionSecret(): Uint8Array {
  const secret = process.env.LABS_SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "LABS_SESSION_SECRET is not set. Generate one with `openssl rand -base64 32`.",
    );
  }
  return new TextEncoder().encode(secret);
}

// Module scope so the fetched key set is reused across requests rather than re-fetched per
// verification. createRemoteJWKSet is lazy — nothing is requested until the first verify.
const jwks = createRemoteJWKSet(new URL(`${LABS_URL}/.well-known/jwks.json`));

/**
 * The origin Labs should hand the token back to.
 *
 * Whatever this resolves to has to be registered in the app's SSO redirect hosts in Labs — exact
 * host match, no wildcards. Preview deployments get a fresh hostname per branch, so
 * VERCEL_PROJECT_PRODUCTION_URL (stable) is preferred over VERCEL_URL (per-deployment).
 */
function appOrigin(): string {
  const explicit = process.env.LABS_APP_ORIGIN;
  if (explicit) return explicit.replace(/\/$/, "");
  const host =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  return `${proto}://${host}`;
}

/** Where to send a browser that has no session yet. `returnPath` comes back to us as `state`. */
export function authorizeUrl(returnPath: string): string {
  const url = new URL(`${LABS_URL}/authorize`);
  url.searchParams.set("app", APP_SLUG);
  url.searchParams.set("redirect_uri", `${appOrigin()}/api/labs-auth/callback`);
  url.searchParams.set("state", returnPath || "/");
  return url.toString();
}

/**
 * Verify a handoff token from Labs. Rejects anything not signed by Labs, not addressed to *this*
 * app, or expired — the audience check is what stops a token minted for another Barrel tool from
 * being replayed here.
 */
export async function verifyLabsToken(token: string): Promise<LabsSession> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: "barrel-labs",
    audience: APP_SLUG,
    algorithms: ["RS256"],
    clockTolerance: 5,
  });

  if (!payload.sub || typeof payload.email !== "string") {
    throw new Error("Labs token is missing required claims.");
  }

  return toSession(payload);
}

/** Mint this app's own session cookie value from a verified Labs identity. */
export async function signSessionCookie(session: LabsSession): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_TTL_SECONDS)
    .sign(sessionSecret());
}

/** Read a session out of this app's own cookie value. Null for absent, tampered or expired. */
export async function verifySessionCookie(
  raw: string | undefined | null,
): Promise<LabsSession | null> {
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw, sessionSecret(), { algorithms: ["HS256"] });
    return toSession(payload);
  } catch {
    return null;
  }
}

/** `role` and `clearance` are only ever read off a verified payload — never off a request. */
function toSession(payload: Record<string, unknown>): LabsSession {
  return {
    sub: String(payload.sub ?? payload.email),
    email: String(payload.email),
    name: (payload.name as string | null) ?? null,
    picture: (payload.picture as string | null) ?? null,
    role: payload.role === "admin" ? "admin" : "member",
    clearance: typeof payload.clearance === "number" ? payload.clearance : 1,
  };
}

/**
 * The surfaces only a Barrel Labs admin may see.
 *
 * Privacy Compliance is deliberately narrower than the rest of the app: it is a standing record of
 * where client sites are, today, dropping tracking cookies before consent. That is a legal
 * exposure list for people who are our clients, and it reads very differently out of context than
 * "here are some findings to fix". The per-store audit reports stay open to everyone.
 *
 * Prefix match on a path segment boundary, so `/consent-something-else` is not caught by accident
 * and `/consent/<site>` is.
 */
const ADMIN_ONLY_PREFIXES = ["/consent", "/api/consent-run"];

export function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
