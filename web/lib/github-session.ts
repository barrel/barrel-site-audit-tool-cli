/**
 * The dashboard's own GitHub connection.
 *
 * The CLI caches a device-flow login at ~/.config/barrel-audit/github-token.json. The deployed
 * dashboard cannot read that file — it isn't on that machine — so it runs the same device flow
 * itself and keeps the result here.
 *
 * Where the token lives, and why: an **encrypted httpOnly cookie**, so it is scoped to one
 * person's browser and never written to shared storage. The alternative — a row in Blob keyed by
 * the signed-in Labs identity — would mean this app holding a durable, write-capable GitHub
 * credential for every teammate in a store that several features already read. A cookie makes the
 * blast radius one browser session, costs no new secret, and disappears when someone signs out of
 * their machine. The trade is that connecting is per-browser rather than per-person: a teammate on
 * a second laptop connects again. That is the right way round for a credential this broad.
 *
 * Encrypted, not merely signed. A signed cookie is readable by anyone who has it, and this one
 * carries a live GitHub token — so it is a JWE (A256GCM) under a key derived from SESSION_SECRET,
 * domain-separated from the share-link HMAC that uses the same secret.
 *
 * GitHub's OAuth Apps have no read-only scope that covers private repository contents (`repo` is
 * all-or-nothing), so this token can technically write. Nothing in this app uses it for anything
 * but reads — see lib/github.ts, which is the only module that touches it.
 */
import { cookies } from "next/headers";
import { CompactEncrypt, compactDecrypt } from "jose";

export const GITHUB_COOKIE_NAME = "barrel_github";
const DEVICE_COOKIE_NAME = "barrel_github_device";

/** Long enough not to be a nuisance, short enough that an unattended browser stops being a way
 * in. GitHub OAuth tokens do not expire on their own, which is exactly why this one does. */
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

/** A device-flow code is valid for ~15 minutes; this only has to outlive the person typing it. */
const DEVICE_MAX_AGE_SECONDS = 60 * 20;

interface GithubSession {
  token: string;
  login: string;
  /** Unix seconds. Checked on read, so a cookie that outlives its window is treated as absent
   * even if the browser kept sending it. */
  expires: number;
}

async function encryptionKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set, so the GitHub connection cannot be stored securely.");
  }
  // Domain-separated from lib/share.ts's `share:` HMAC over the same secret: two different uses of
  // one secret must not produce interchangeable material.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`github-session:${secret}`));
  return await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function seal(session: GithubSession): Promise<string> {
  const key = await encryptionKey();
  return await new CompactEncrypt(new TextEncoder().encode(JSON.stringify(session)))
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .encrypt(key);
}

async function unseal(raw: string): Promise<GithubSession | null> {
  try {
    const key = await encryptionKey();
    const { plaintext } = await compactDecrypt(raw, key);
    const session = JSON.parse(new TextDecoder().decode(plaintext)) as GithubSession;
    if (!session?.token || !session.expires || session.expires < Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

export async function getGithubSession(): Promise<{ login: string } | null> {
  const raw = (await cookies()).get(GITHUB_COOKIE_NAME)?.value;
  const session = raw ? await unseal(raw) : null;
  return session ? { login: session.login } : null;
}

/** The token itself. Only lib/github.ts should need this. */
export async function getGithubAccessToken(): Promise<string | null> {
  const raw = (await cookies()).get(GITHUB_COOKIE_NAME)?.value;
  return (raw ? await unseal(raw) : null)?.token ?? null;
}

export async function startGithubSession(token: string, login: string): Promise<void> {
  const value = await seal({ token, login, expires: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS });
  (await cookies()).set(GITHUB_COOKIE_NAME, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function endGithubSession(): Promise<void> {
  (await cookies()).delete(GITHUB_COOKIE_NAME);
  (await cookies()).delete(DEVICE_COOKIE_NAME);
}

/* ── The in-flight device code ───────────────────────────────────────────────────────────────
 *
 * The device_code is the thing that gets exchanged for a token, so it is held server-side in its
 * own httpOnly cookie rather than handed to the page and posted back. The page only ever sees the
 * user_code (the part meant to be read aloud and typed into github.com) and the verification URL.
 */

export async function stashDeviceCode(deviceCode: string, interval: number): Promise<void> {
  const value = await seal({ token: deviceCode, login: String(interval), expires: Math.floor(Date.now() / 1000) + DEVICE_MAX_AGE_SECONDS });
  (await cookies()).set(DEVICE_COOKIE_NAME, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/github",
    maxAge: DEVICE_MAX_AGE_SECONDS,
  });
}

export async function readDeviceCode(): Promise<{ deviceCode: string; interval: number } | null> {
  const raw = (await cookies()).get(DEVICE_COOKIE_NAME)?.value;
  const stashed = raw ? await unseal(raw) : null;
  if (!stashed) return null;
  return { deviceCode: stashed.token, interval: Number.parseInt(stashed.login, 10) || 5 };
}

export async function clearDeviceCode(): Promise<void> {
  (await cookies()).delete(DEVICE_COOKIE_NAME);
}
